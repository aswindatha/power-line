from machine import Pin
import time

class HX711:
    def __init__(self, dout, pd_sck):
        self.pd_sck = Pin(pd_sck, Pin.OUT)
        self.dout = Pin(dout, Pin.IN)
        self.pd_sck.value(0)

    def read(self):
        while self.dout.value() == 1:
            pass

        count = 0

        for _ in range(24):
            self.pd_sck.value(1)
            count = count << 1
            self.pd_sck.value(0)

            if self.dout.value():
                count += 1

        self.pd_sck.value(1)
        self.pd_sck.value(0)

        if count & 0x800000:
            count -= 0x1000000

        return count