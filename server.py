# new.py - Laptop-hosted Command Center for PowerLine Guard
# Reads ESP32-C3 data via Serial and hosts the monitoring dashboard on the local network.

import re
import time
import socket
import random
import threading
import serial
import serial.tools.list_ports
from flask import Flask, jsonify, request
from html_templates import get_dashboard_html

# ============ Configuration ============
DEFAULT_PORT = "COM6"
BAUD_RATE = 115200
FLASK_PORT = 5000

# ============ Global State & Thread Safety ============
monitoring = False
baseline = 0.0
current_tension = 0.0
status = "SAFE"
location = "SUBSTATION-ALPHA-4"
reading_history = []

ALERT_THRESHOLD = 0.70      # 70% of baseline (trigger alert below this)
CLEAR_THRESHOLD = 0.85      # 85% of baseline (clear alert above this, hysteresis)
MAX_HISTORY = 60

simulation_mode = False
stop_thread = False
data_lock = threading.Lock()

app = Flask(__name__)

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

def find_serial_port():
    """Find the best serial port: prefers DEFAULT_PORT (COM6) or the first available COM port"""
    ports = list(serial.tools.list_ports.comports())
    if not ports:
        return None
    
    # Try default port first
    for p in ports:
        if p.device == DEFAULT_PORT:
            return DEFAULT_PORT
            
    # Fallback to the first available COM port
    return ports[0].device

def parse_serial_value(line):
    """Robustly extract any decimal or integer number from a serial line"""
    # 1. Look for 'Weight:' first and extract the float value next to it (e.g. Weight: -0.008 g)
    weight_match = re.search(r"Weight:\s*([-+]?\d*\.\d+|[-+]?\d+)", line, re.IGNORECASE)
    if weight_match:
        try:
            return max(0.0, float(weight_match.group(1)))
        except ValueError:
            pass
            
    # 2. Otherwise, check if the entire line represents a single float value (with optional units)
    number_only_match = re.match(r"^\s*([-+]?\d*\.\d+|[-+]?\d+)\s*(?:g|kN)?\s*$", line, re.IGNORECASE)
    if number_only_match:
        try:
            return max(0.0, float(number_only_match.group(1)))
        except ValueError:
            pass
            
    return None

def update_sensor_value(val):
    """Thread-safe update of current tension and alert checking"""
    global current_tension, status, reading_history
    with data_lock:
        current_tension = val
        if monitoring:
            reading_history.append(current_tension)
            if len(reading_history) > MAX_HISTORY:
                reading_history.pop(0)
                
            # Alert checking logic (matching sensor_handler.py)
            if status == "SAFE":
                if current_tension < baseline * ALERT_THRESHOLD:
                    status = "ALERT"
                    print(f"🚨 ALERT! Tension dropped to {current_tension:.2f} kN (Baseline: {baseline:.2f} kN)")
            else:  # status is ALERT
                if current_tension > baseline * CLEAR_THRESHOLD:
                    status = "SAFE"
                    print(f"✅ Alert cleared. Tension: {current_tension:.2f} kN (Baseline: {baseline:.2f} kN)")

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
    simulated_tension = 30.0
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
            if monitoring and (sim_step % 120) > 80:
                # Simulate drop down to ~45% of baseline
                simulated_tension = baseline * 0.45 + random.uniform(-0.5, 0.5)
            else:
                # Normal minor grid tension fluctuations around 30.0 kN
                simulated_tension = 30.0 + random.uniform(-0.5, 0.5)
            
            # Clamp tension values logically
            simulated_tension = max(0.0, min(100.0, simulated_tension))
            update_sensor_value(simulated_tension)
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
                    val = parse_serial_value(line)
                    if val is not None:
                        update_sensor_value(val)
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

# ============ Web Server Routing ============
@app.route("/")
@app.route("/index.html")
def index():
    """Serve the central command dashboard page"""
    with data_lock:
        status_data = {
            'monitoring': monitoring,
            'tension': current_tension,
            'baseline': baseline,
            'status': status,
            'history': reading_history[-20:] if reading_history else [current_tension] * 20
        }
    return get_dashboard_html(location=location, status_data=status_data)

@app.route("/api/status")
def api_status():
    """Serve JSON representation of current monitoring status"""
    with data_lock:
        return jsonify({
            'monitoring': monitoring,
            'tension': round(current_tension, 1),
            'baseline': round(baseline, 1),
            'status': status,
            'location': location,
            'history': reading_history[-20:] if reading_history else [current_tension] * 20
        })

@app.route("/api/start")
def api_start():
    """Start monitoring using the current tension as baseline"""
    global baseline, monitoring, status, reading_history
    with data_lock:
        baseline = current_tension
        monitoring = True
        status = "SAFE"
        reading_history = []
        print(f"▶️ Monitoring started. Baseline set to {baseline:.2f} kN")
    return jsonify({"status": "ok"})

@app.route("/api/stop")
def api_stop():
    """Stop monitoring"""
    global monitoring, status
    with data_lock:
        monitoring = False
        status = "SAFE"
        print("⏸️ Monitoring stopped")
    return jsonify({"status": "ok"})

@app.route("/api/location")
def api_location():
    """Update node location name"""
    global location
    new_loc = request.args.get('name')
    if new_loc:
        with data_lock:
            location = new_loc
            print(f"📍 Location name updated to: {location}")
    return jsonify({"status": "ok", "location": location})

# ============ Main Execution ============
if __name__ == "__main__":
    # Start the serial background thread
    reader_thread = threading.Thread(target=run_serial_reader, daemon=True)
    reader_thread.start()
    
    local_ip = get_local_ip()
    
    print("\n" + "="*60)
    print("⚡ POWERLINE GUARD COMMAND CENTER - HOSTED ONLINE")
    print("="*60)
    print(f"🔗 Local Webpage:   http://127.0.0.1:{FLASK_PORT}")
    print(f"🔗 Network Webpage: http://{local_ip}:{FLASK_PORT}")
    print(f"   (Use the Network link on other devices connected to the same Wi-Fi)")
    print("="*60 + "\n")
    
    try:
        # Run Flask server accessible on all interfaces
        app.run(host="0.0.0.0", port=FLASK_PORT, debug=False, use_reloader=False)
    except KeyboardInterrupt:
        print("\nShutting down server...")
    finally:
        stop_thread = True
        reader_thread.join(timeout=1.0)
        print("Goodbye.")