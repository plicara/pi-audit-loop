.PHONY: setup metadata check

setup:
	npm ci --ignore-scripts

metadata:
	uv run --python 3.12 --locked --script .plicara/check.py

check: metadata
	npm run check
