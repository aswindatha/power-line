from hx711 import HX711
import time

hx = HX711(dout=2, pd_sck=3)

print("Remove all weight...")
time.sleep(3)

offset = hx.read()
print("Offset:", offset)

scale = 1000   # calibrate later

while True:
    raw = hx.read()
    weight = (raw - offset) / scale

    print("Raw:", raw, " Weight:", weight, "g")
    time.sleep(1)