# server.py - Laptop-hosted Command Center for PowerLine Guard
# Reads ESP32-C3 data via Serial, prints a terminal QR code, and hosts/serves the monitoring dashboard.

import re
import os
import time
import argparse
import socket
import random
import threading
import sys
if hasattr(sys.stdout, 'reconfigure'):
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass
if hasattr(sys.stderr, 'reconfigure'):
    try:
        sys.stderr.reconfigure(encoding='utf-8')
    except Exception:
        pass
import serial
import serial.tools.list_ports
from flask import Flask, jsonify, request, send_from_directory

# Attempt to import qrcode, if missing try to install it programmatically
try:
    import qrcode
except ImportError:
    try:
        import subprocess
        print("🔧 qrcode library not found. Attempting to install...")
        subprocess.check_call([sys.executable, "-m", "pip", "install", "qrcode pillow"])
        import qrcode
    except Exception as e:
        print(f"⚠️ Could not install qrcode library automatically: {e}")
        print("Please install manually: pip install qrcode pillow")
        qrcode = None

# ============ Configuration / CLI Arguments ============
def parse_arguments():
    parser = argparse.ArgumentParser(description="POWERLINE GUARD COMMAND CENTER")
    parser.add_argument(
        "--port", "-p",
        default=os.environ.get("SERIAL_PORT"),
        help="Serial port (e.g., COM5, /dev/ttyUSB0). If not specified, auto-detects 'USB Serial Device' or first available COM port."
    )
    parser.add_argument(
        "--baud", "-b",
        type=int,
        default=int(os.environ.get("SERIAL_BAUD", 115200)),
        help="Baud rate (default: 115200)"
    )
    parser.add_argument(
        "--web-port", "-w",
        type=int,
        default=int(os.environ.get("FLASK_PORT", 5000)),
        help="Web dashboard Flask port (default: 5000)"
    )
    parser.add_argument(
        "--baseline",
        type=float,
        default=float(os.environ.get("BASELINE", 850.0)),
        help="Default nominal baseline in Newtons (default: 850.0)"
    )
    parser.add_argument(
        "--station",
        default=os.environ.get("STATION_NAME", "Station Alpha"),
        help="Station name (default: Station Alpha)"
    )
    parser.add_argument(
        "--line",
        default=os.environ.get("TRANSMISSION_LINE", "Line 12"),
        help="Transmission line name (default: Line 12)"
    )
    parser.add_argument(
        "--maps-url",
        default=os.environ.get("MAPS_URL", "https://maps.app.goo.gl/cG3Vp3PG5SM1JvLQ9"),
        help="Google Maps URL location of the station"
    )
    args, _ = parser.parse_known_args()
    return args

args = parse_arguments()

DEFAULT_PORT = args.port
BAUD_RATE = args.baud
FLASK_PORT = args.web_port

# ============ Global State & Thread Safety ============
monitoring = False
baseline = args.baseline  # Default nominal baseline in Newtons
current_tension = baseline - 3.0
status = "SAFE"
station_name = args.station
transmission_line = args.line
maps_url = args.maps_url
reading_history = []

ALERT_THRESHOLD = 0.70      # 70% of baseline (trigger warning/alert below this)
MAX_HISTORY = 60

simulation_mode = False
stop_thread = False
data_lock = threading.Lock()

# Define the Flask application
# Serve static build files from mobile_app/dist at the root
app = Flask(__name__, static_folder='mobile_app/dist', static_url_path='')

# ============ CORS Support ============
@app.after_request
def add_cors_headers(response):
    response.headers['Access-Control-Allow-Origin'] = '*'
    response.headers['Access-Control-Allow-Headers'] = 'Content-Type,Authorization'
    response.headers['Access-Control-Allow-Methods'] = 'GET,PUT,POST,DELETE,OPTIONS'
    return response

# Handle pre-flight options requests for all endpoints
@app.route('/api/<path:path>', methods=['OPTIONS'])
def options_handler(path):
    return jsonify({"status": "ok"})

# ============ Helpers ============
def get_local_ip():
    """Retrieve the preferred local IP address of this laptop on the network"""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"

def print_qr_code():
    """Print the QR code in the terminal using Unicode blocks (matching qr.py)"""
    local_ip = get_local_ip()
    network_url = f"http://{local_ip}:{FLASK_PORT}"
    
    if qrcode:
        try:
            print("\n" + "="*60)
            print("Scan this QR with mobile app to connect dashboard:")
            print("="*60 + "\n")
            
            qr = qrcode.QRCode(border=2)
            qr.add_data(network_url)
            qr.make(fit=True)
            matrix = qr.get_matrix()
            
            BLACK = "██"
            WHITE = "  "
            for row in matrix:
                print("".join(BLACK if cell else WHITE for cell in row))
            
            print(f"\nURL: {network_url}")
            print("="*60 + "\n")
        except Exception as e:
            print(f"⚠️ Could not print QR code: {e}")
            print(f"\nURL: {network_url}\n")
    else:
        print("\n" + "="*60)
        print(f"🔗 Network Webpage: {network_url}")
        print("[Tip] Install qrcode: `pip install qrcode pillow` to print QR code in terminal.")
        print("="*60 + "\n")

def run_keyboard_listener():
    """Thread to listen for keyboard inputs on Windows (using msvcrt) and Linux/macOS (stdin)"""
    try:
        import msvcrt
        is_windows = True
    except ImportError:
        is_windows = False
        
    print("⌨️  Press 'q' at any time to reprint the QR code in the terminal.")
    
    while not stop_thread:
        if is_windows:
            try:
                if msvcrt.kbhit():
                    ch = msvcrt.getch()
                    # Check if key is 'q' or 'Q' (getch returns bytes on Windows)
                    if ch.lower() == b'q':
                        print_qr_code()
            except Exception:
                pass
            time.sleep(0.1)
        else:
            # Non-Windows fallback (blocking readline)
            try:
                line = sys.stdin.readline().strip()
                if line.lower() == 'q':
                    print_qr_code()
            except Exception:
                pass

def find_serial_port():
    """Find the best serial port: prefers ports with 'USB Serial Device' in description, then DEFAULT_PORT if set"""
    ports = list(serial.tools.list_ports.comports())
    if not ports:
        return None
    
    # 1. Look for a port matching 'USB Serial Device' in its description
    for p in ports:
        description = p.description or ""
        if "usb serial device" in description.lower():
            return p.device
            
    # 2. Try default port next
    if DEFAULT_PORT:
        for p in ports:
            if p.device == DEFAULT_PORT:
                return DEFAULT_PORT
                
    return None

def parse_serial_line(line):
    """Parse serial line formatted as 'Weight: <val> Status: <status>' or similar"""
    weight_match = re.search(r"Weight:\s*([-+]?\d*\.\d+|[-+]?\d+)", line, re.IGNORECASE)
    status_match = re.search(r"Status:\s*(\w+)", line, re.IGNORECASE)
    
    weight_val = None
    status_val = None
    
    if weight_match:
        try:
            weight_val = float(weight_match.group(1))
        except ValueError:
            pass
            
    if status_match:
        status_val = status_match.group(1).upper()
        
    return weight_val, status_val

def update_sensor_value(val, esp_status=None):
    """Thread-safe update of current tension and alert checking"""
    global current_tension, status, reading_history
    with data_lock:
        current_tension = val
        if monitoring:
            reading_history.append(current_tension)
            if len(reading_history) > MAX_HISTORY:
                reading_history.pop(0)
                
            # If the ESP32 explicitly reports a CUT, or if tension is near zero/critically low
            if esp_status == "CUT" or current_tension < 10.0:
                status = "ALERT"
            # Otherwise, evaluate thresholds relative to baseline
            elif current_tension < baseline * ALERT_THRESHOLD:
                status = "ALERT"
            elif current_tension < baseline * 0.85:
                status = "WARNING"
            else:
                status = "SAFE"

# ============ Serial Reading & Simulation Thread ============
def run_serial_reader():
    """Background thread to read serial port with auto-reconnection and simulation fallback"""
    global simulation_mode
    
    port = find_serial_port()
    if not port:
        print("⚠️ No serial ports found. Starting in SIMULATION MODE.")
        simulation_mode = True
    else:
        print(f"🔌 Connecting to ESP32 on {port}...")
        simulation_mode = False

    ser = None
    sim_step = 0
    simulated_tension = 847.0
    reconnect_cooldown = 0

    while not stop_thread:
        # If we are in serial mode but serial port is not opened yet, try to open it
        if not simulation_mode and ser is None:
            try:
                ser = serial.Serial(port, BAUD_RATE, timeout=1)
                print(f"✅ Connected to ESP32 on {port}!")
            except Exception as e:
                print(f"⚠️ Failed to connect to serial port {port}: {e}")
                print("Switching to SIMULATION MODE.")
                simulation_mode = True
                reconnect_cooldown = 0
        
        if simulation_mode:
            sim_step += 1
            # Run simulation step
            # Periodically simulate a drop (cut) to show the emergency screen
            if monitoring and (sim_step % 60) > 40:
                # Simulate drop down to ~0-5 N
                simulated_tension = random.uniform(0.0, 3.0)
                update_sensor_value(simulated_tension, "CUT")
            else:
                # Normal minor grid tension fluctuations around nominal baseline (e.g. 847 N)
                simulated_tension = baseline + random.uniform(-5.0, 5.0)
                update_sensor_value(simulated_tension, "SAFE")
            
            time.sleep(0.5)
            
            # Periodically try to scan and connect to serial
            reconnect_cooldown += 1
            if reconnect_cooldown >= 20:  # Every 10 seconds
                reconnect_cooldown = 0
                check_port = find_serial_port()
                if check_port:
                    try:
                        ser = serial.Serial(check_port, BAUD_RATE, timeout=1)
                        port = check_port
                        print(f"🔌 Serial device found and connected on {port}! Disabling simulation mode.")
                        simulation_mode = False
                    except Exception:
                        pass
        else:
            # Read from serial
            try:
                line = ser.readline().decode('utf-8', errors='ignore').strip()
                if line:
                    val, esp_status = parse_serial_line(line)
                    if val is not None:
                        update_sensor_value(val, esp_status)
            except (serial.SerialException, OSError):
                print(f"⚠️ Serial connection on {port} lost. Switching to SIMULATION MODE...")
                if ser:
                    try:
                        ser.close()
                    except Exception:
                        pass
                ser = None
                simulation_mode = True
                reconnect_cooldown = 0

# ============ API endpoints ============
@app.route("/api/status")
def api_status():
    """Serve JSON representation of current monitoring status"""
    with data_lock:
        return jsonify({
            'monitoring': monitoring,
            'tension': round(current_tension, 1),
            'baseline': round(baseline, 1),
            'status': status,
            'station_name': station_name,
            'transmission_line': transmission_line,
            'maps_url': maps_url,
            'history': reading_history[-20:] if reading_history else [current_tension] * 20
        })

@app.route("/api/start", methods=['POST'])
def api_start():
    """Start monitoring using the current tension as baseline"""
    global baseline, monitoring, status, reading_history
    with data_lock:
        baseline = current_tension if current_tension > 10.0 else 850.0
        monitoring = True
        status = "SAFE"
        reading_history = []
        print(f"▶️ Monitoring started. Baseline set to {baseline:.2f} N")
    return jsonify({"status": "ok"})

@app.route("/api/stop", methods=['POST'])
def api_stop():
    """Stop monitoring"""
    global monitoring, status
    with data_lock:
        monitoring = False
        status = "SAFE"
        print("⏸️ Monitoring stopped")
    return jsonify({"status": "ok"})

@app.route("/api/settings", methods=['POST'])
def api_settings():
    """Update settings (station name, line name, maps URL)"""
    global station_name, transmission_line, maps_url
    data = request.json or {}
    
    with data_lock:
        if 'station_name' in data:
            station_name = data['station_name']
        if 'transmission_line' in data:
            transmission_line = data['transmission_line']
        if 'maps_url' in data:
            maps_url = data['maps_url']
            
        print(f"📍 Settings updated: {station_name} | {transmission_line} | {maps_url}")
        
    return jsonify({
        "status": "ok",
        "station_name": station_name,
        "transmission_line": transmission_line,
        "maps_url": maps_url
    })

# ============ Serving React App Build ============
@app.route('/', defaults={'path': ''})
@app.route('/<path:path>')
def serve(path):
    """Serve the static React build files"""
    static_folder = app.static_folder
    
    if not static_folder:
        return "React app build folder not configured.", 500
        
    # Serve index.html if file doesn't exist or is root
    if path == "" or not os.path.exists(os.path.join(static_folder, path)):
        return send_from_directory(static_folder, 'index.html')
        
    return send_from_directory(static_folder, path)

# ============ Main Execution ============
if __name__ == "__main__":
    # If no serial port is automatically identified, prompt the user for input
    port = find_serial_port()
    if not port:
        ports = list(serial.tools.list_ports.comports())
        if ports:
            print("\n⚠️ Could not automatically detect a 'USB Serial Device' or default port.")
            print("Available COM ports:")
            for i, p in enumerate(ports):
                print(f"  [{i+1}] {p.device} - {p.description}")
            try:
                user_val = input(f"Select a port (1-{len(ports)}) or type the COM port name (or press Enter for Simulation Mode): ").strip()
                if user_val:
                    if user_val.isdigit():
                        idx = int(user_val) - 1
                        if 0 <= idx < len(ports):
                            DEFAULT_PORT = ports[idx].device
                            print(f"Selected port: {DEFAULT_PORT}")
                        else:
                            print("Invalid selection. Starting in SIMULATION MODE.")
                    else:
                        DEFAULT_PORT = user_val
                        print(f"Selected port: {DEFAULT_PORT}")
            except Exception as e:
                print(f"Error reading input: {e}")
                
    # Start the serial background thread
    reader_thread = threading.Thread(target=run_serial_reader, daemon=True)
    reader_thread.start()
    
    # Start the keyboard listener background thread
    listener_thread = threading.Thread(target=run_keyboard_listener, daemon=True)
    listener_thread.start()
    
    local_ip = get_local_ip()
    network_url = f"http://{local_ip}:{FLASK_PORT}"
    
    print("\n" + "="*60)
    print("⚡ POWERLINE GUARD COMMAND CENTER")
    print("="*60)
    print(f"🔗 Local Webpage:   http://127.0.0.1:{FLASK_PORT}")
    print(f"🔗 Network Webpage: {network_url}")
    print(f"   (Connect your phone to the same Wi-Fi and open this URL)")
    print("="*60)
    
    # Print the QR code using block characters
    print_qr_code()
        
    try:
        # Run Flask server accessible on all interfaces
        app.run(host="0.0.0.0", port=FLASK_PORT, debug=False, use_reloader=False)
    except KeyboardInterrupt:
        print("\nShutting down server...")
    finally:
        stop_thread = True
        reader_thread.join(timeout=1.0)
        print("Goodbye.")