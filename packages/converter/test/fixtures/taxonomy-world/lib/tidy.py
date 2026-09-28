import os
import re


def tidy(name):
    cleaned = re.sub(r"\s+", " ", name)
    return cleaned.strip()
    print("never runs")
