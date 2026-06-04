package cache

import (
	"context"
	"fmt"
	"os"
	"strconv"

	"github.com/redis/go-redis/v9"
)

type RedisClient struct {
	Client *redis.Client
	Ctx    context.Context
}

var Redis *RedisClient

func InitRedis() error {
	host := getEnv("REDIS_HOST", "localhost")
	port := getEnv("REDIS_PORT", "6379")
	password := getEnv("REDIS_PASSWORD", "")
	db := getEnvInt("REDIS_DB", 0)

	client := redis.NewClient(&redis.Options{
		Addr:     fmt.Sprintf("%s:%s", host, port),
		Password: password,
		DB:       db,
	})

	ctx := context.Background()

	if err := client.Ping(ctx).Err(); err != nil {
		return fmt.Errorf("failed to connect to Redis: %w", err)
	}

	Redis = &RedisClient{
		Client: client,
		Ctx:    ctx,
	}

	return nil
}

func (r *RedisClient) Exists(key string) (bool, error) {
	if r == nil || r.Client == nil {
		return false, nil
	}
	count, err := r.Client.Exists(r.Ctx, key).Result()
	if err != nil {
		return false, err
	}
	return count == 1, nil
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func getEnvInt(key string, fallback int) int {
	if v := os.Getenv(key); v != "" {
		if i, err := strconv.Atoi(v); err == nil {
			return i
		}
	}
	return fallback
}
