package repository

import "gorm.io/gorm"

var publicUserColumns = []string{
	"id",
	"name",
	"age",
	"bio",
	"avatar",
	"avatar_position_x",
	"avatar_position_y",
	"avatar_scale",
	"is_email_verified",
	"created_at",
	"updated_at",
	"last_seen_at",
}

func preloadPublicUser(db *gorm.DB) *gorm.DB {
	return db.Select(publicUserColumns)
}

func qualifiedPublicUserColumns(table string) []string {
	columns := make([]string, 0, len(publicUserColumns))
	for _, column := range publicUserColumns {
		columns = append(columns, table+"."+column)
	}
	return columns
}
