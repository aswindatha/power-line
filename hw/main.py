from hx711 import HX711
import time

# Initialize HX711 on Pins 2 (DOUT) and 3 (SCK)
hx = HX711(dout=2, pd_sck=3)

print("Calibrating sensor... Remove all weight from the load cell.")
time.sleep(3)

# Read tare weight
offset = hx.read()
print("Tare offset calibration completed:", offset)

# scale factor to convert raw value to Tension (in Newtons)
# Adjust this scale factor according to physical calibration trials
scale = 1000.0   

# Cut threshold in Newtons. If tension drops below this, we suspect a cut line.
CUT_THRESHOLD = 5.0

while True:
    try:
        raw = hx.read()
        # Calculate tension in Newtons
        tension = max(0.0, (raw - offset) / scale)
        
        # Edge check logic: if weight/tension is below threshold, status is CUT, else SAFE
        status = "CUT" if tension < CUT_THRESHOLD else "SAFE"
        
        # Telemetry output format for serial read: Weight: <val> Status: <status>
        print("Weight: {:.2f} Status: {}".format(tension, status))
        
    except Exception as e:
        print("Sensor Read Error: {}".format(e))
        
    time.sleep(1)