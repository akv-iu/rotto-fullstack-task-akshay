.PHONY: setup dev test

setup:
	npm ci
	npm run db:setup

dev:
	npm run dev

test:
	npm test
