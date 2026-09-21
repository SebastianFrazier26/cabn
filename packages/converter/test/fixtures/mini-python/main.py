#!/usr/bin/env python3
"""Entry point for the mini-python fixture."""

from pkg.sub.helper import greet


def main() -> None:
    print(greet("cabn"))


if __name__ == "__main__":
    main()
