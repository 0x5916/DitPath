package handlers

import (
	"html/template"
	"net/http"
	"strings"

	"opencw/internal/models"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

const UnsubscribePath = "/v1/email/unsubscribe"

type unsubscribeText struct{ Lang, Title, Action, Done string }

var unsubscribeLanguages = []unsubscribeText{
	{"en", "Stop these Morsewell emails?", "Unsubscribe", "You’re unsubscribed from this email topic."},
	{"de", "Diese Morsewell-E-Mails abbestellen?", "Abbestellen", "Dieses E-Mail-Thema wurde abbestellt."},
	{"ja", "この種類の Morsewell メールを停止しますか？", "配信を停止", "この種類のメール配信を停止しました。"},
	{"zh-Hans", "停止接收此类 Morsewell 邮件？", "退订", "已退订此类邮件。"},
	{"zh-Hant", "停止接收此類 Morsewell 郵件？", "取消訂閱", "已取消訂閱此類郵件。"},
}

var unsubscribePage = template.Must(template.New("unsubscribe").Parse(`<!doctype html><html lang="{{.Lang}}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Morsewell</title><main><h1>{{if .Complete}}{{.Done}}{{else}}{{.Title}}{{end}}</h1>{{if not .Complete}}<form method="post"><input type="hidden" name="List-Unsubscribe" value="One-Click"><button type="submit">{{.Action}}</button></form>{{end}}</main></html>`))

func (h EmailPreferencesHandler) Unsubscribe(c *gin.Context) {
	db := privateMailDB(c, h.DB)
	c.Header("Referrer-Policy", "no-referrer")
	c.Header("X-Robots-Tag", "noindex, nofollow")
	c.Header("Content-Security-Policy", "default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'")
	token, err := uuid.Parse(c.Query("token"))
	if err != nil || token.Version() != 4 || len(c.Request.URL.Query()["token"]) != 1 {
		c.Status(400)
		return
	}
	complete := c.Request.Method == http.MethodPost
	if complete {
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 4096)
		switch c.ContentType() {
		case "multipart/form-data":
			err = c.Request.ParseMultipartForm(4096)
		case "application/x-www-form-urlencoded":
			err = c.Request.ParseForm()
		default:
			c.Status(415)
			return
		}
		if err != nil || len(c.Request.PostForm["List-Unsubscribe"]) != 1 || c.Request.PostForm.Get("List-Unsubscribe") != "One-Click" {
			c.Status(400)
			return
		}
		if err := db.Where("token=?", token).Delete(&models.EmailConsent{}).Error; err != nil {
			adminDBFailure(c)
			return
		}
	}
	lang := strings.ToLower(strings.SplitN(c.GetHeader("Accept-Language"), ",", 2)[0])
	copy := unsubscribeLanguages[0]
	switch {
	case strings.HasPrefix(lang, "de"):
		copy = unsubscribeLanguages[1]
	case strings.HasPrefix(lang, "ja"):
		copy = unsubscribeLanguages[2]
	case strings.HasPrefix(lang, "zh-hant"), strings.HasPrefix(lang, "zh-tw"), strings.HasPrefix(lang, "zh-hk"):
		copy = unsubscribeLanguages[4]
	case strings.HasPrefix(lang, "zh"):
		copy = unsubscribeLanguages[3]
	}
	c.Header("Content-Type", "text/html; charset=utf-8")
	_ = unsubscribePage.Execute(c.Writer, struct {
		unsubscribeText
		Complete bool
	}{copy, complete})
}
