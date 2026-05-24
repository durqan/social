.PHONY: dev-infra dev-backend dev-frontend dev-mobile stop-infra

dev-infra:
	docker compose up -d

stop-infra:
	docker compose down

dev-backend:
	cd backend && go run ./cmd/api

dev-frontend:
	cd frontend && npm run dev

dev-mobile:
	cd mobile && npm run start
