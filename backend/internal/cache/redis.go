package cache

import (
	"context"
	"fmt"
	"tester/internal/config"

	"github.com/redis/go-redis/v9"
)

type RedisClient struct {
	Client *redis.Client
	Ctx    context.Context
}

var Redis *RedisClient

func InitRedis(cfg *config.Config) error {
	client := redis.NewClient(&redis.Options{
		Addr:     fmt.Sprintf("%s:%s", cfg.RedisHost, cfg.RedisPort),
		Password: cfg.RedisPassword,
		DB:       cfg.RedisDB,
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

func (r *RedisClient) Delete(key string) error {
	return r.Client.Del(r.Ctx, key).Err()
}

func (r *RedisClient) DeletePattern(pattern string) error {
	var cursor uint64

	for {
		keys, nextCursor, err := r.Client.Scan(
			r.Ctx,
			cursor,
			pattern,
			100,
		).Result()

		if err != nil {
			return err
		}

		if len(keys) > 0 {
			if err := r.Client.Del(r.Ctx, keys...).Err(); err != nil {
				return err
			}
		}

		cursor = nextCursor

		if cursor == 0 {
			break
		}
	}

	return nil
}
