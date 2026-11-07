package utils

import (
	"crypto/rand"
	"fmt"
	"math/big"
	"opencw/internal/configs"
	"strings"

	"github.com/resend/resend-go/v4"
)

func GenerateVerificationCode() (string, error) {
	n, err := rand.Int(rand.Reader, big.NewInt(1000000))
	if err != nil {
		return "", err
	}

	return fmt.Sprintf("%06d", n.Int64()), nil
}

func verificationEmail(toEmail string, code string) *resend.SendEmailRequest {
	return &resend.SendEmailRequest{
		From:    configs.App.ResendFromEmail,
		To:      []string{toEmail},
		Subject: "Verify your DitPath email",
		Text: strings.Join([]string{
			"Use this code to verify your DitPath email:",
			code,
			"",
			"This code expires in 10 minutes.",
		}, "\n"),
	}
}

func SendVerificationEmail(toEmail string, code string) error {
	client := resend.NewClient(configs.App.ResendAPIKey)

	_, err := client.Emails.Send(verificationEmail(toEmail, code))
	return err
}
