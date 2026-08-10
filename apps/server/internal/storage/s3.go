package storage

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path"
	"sort"
	"strings"
	"time"

	"github.com/psy-zney/beatsync/apps/server/internal/config"
)

type Object struct {
	Key          string
	Size         int64
	LastModified time.Time
}

type Client struct {
	bucket, publicURL, accessKey, secretKey, region string
	endpoint                                        *url.URL
	http                                            *http.Client
}

func New(c config.Config) (*Client, error) {
	if !c.StorageConfigured() {
		return nil, errors.New("object storage is not configured")
	}
	endpoint, err := url.Parse(c.S3Endpoint)
	if err != nil {
		return nil, fmt.Errorf("parse S3_ENDPOINT: %w", err)
	}
	return &Client{
		bucket: c.S3Bucket, publicURL: c.S3PublicURL, accessKey: c.S3AccessKey,
		secretKey: c.S3SecretKey, region: c.S3Region, endpoint: endpoint,
		http: &http.Client{Timeout: 45 * time.Second},
	}, nil
}

func (c *Client) PublicURL(key string) string {
	parts := strings.Split(key, "/")
	for i := range parts {
		parts[i] = url.PathEscape(parts[i])
	}
	return strings.TrimRight(c.publicURL, "/") + "/" + strings.Join(parts, "/")
}

func (c *Client) PresignPut(key, contentType string, expires time.Duration) (string, error) {
	now := time.Now().UTC()
	u := c.objectURL(key)
	credentialScope := now.Format("20060102") + "/" + c.region + "/s3/aws4_request"
	q := u.Query()
	q.Set("X-Amz-Algorithm", "AWS4-HMAC-SHA256")
	q.Set("X-Amz-Credential", c.accessKey+"/"+credentialScope)
	q.Set("X-Amz-Date", now.Format("20060102T150405Z"))
	q.Set("X-Amz-Expires", fmt.Sprintf("%d", int(expires.Seconds())))
	q.Set("X-Amz-SignedHeaders", "content-type;host")
	u.RawQuery = q.Encode()
	canonical := strings.Join([]string{
		http.MethodPut, u.EscapedPath(), u.RawQuery,
		"content-type:" + strings.TrimSpace(contentType) + "\n" + "host:" + u.Host + "\n",
		"content-type;host", "UNSIGNED-PAYLOAD",
	}, "\n")
	stringToSign := signatureString(now, credentialScope, canonical)
	q.Set("X-Amz-Signature", hex.EncodeToString(hmacSHA(signingKey(c.secretKey, now, c.region), stringToSign)))
	u.RawQuery = q.Encode()
	return u.String(), nil
}

func (c *Client) PutJSON(ctx context.Context, key string, value any) error {
	data, err := json.Marshal(value)
	if err != nil {
		return err
	}
	return c.PutBytes(ctx, key, "application/json", data)
}

func (c *Client) GetJSON(ctx context.Context, key string, maxBytes int64, target any) error {
	response, err := c.signedRequest(ctx, http.MethodGet, key, nil, nil, "", emptySHA256)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode == http.StatusNotFound {
		return os.ErrNotExist
	}
	if response.StatusCode/100 != 2 {
		return responseError(response)
	}
	decoder := json.NewDecoder(io.LimitReader(response.Body, maxBytes+1))
	return decoder.Decode(target)
}

func (c *Client) PutBytes(ctx context.Context, key, contentType string, data []byte) error {
	hash := sha256.Sum256(data)
	response, err := c.signedRequest(ctx, http.MethodPut, key, nil, bytes.NewReader(data), contentType, hex.EncodeToString(hash[:]))
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode/100 != 2 {
		return responseError(response)
	}
	return nil
}

// UploadStream spools to disk, not RAM. This keeps process RSS flat for large
// audio while still producing the payload hash required by S3-compatible APIs.
func (c *Client) UploadStream(ctx context.Context, key, contentType string, source io.Reader, maxBytes int64) error {
	tmp, err := os.CreateTemp("", "beatsync-upload-*")
	if err != nil {
		return err
	}
	name := tmp.Name()
	defer os.Remove(name)

	hasher := sha256.New()
	written, copyErr := io.Copy(io.MultiWriter(tmp, hasher), io.LimitReader(source, maxBytes+1))
	if closeErr := tmp.Close(); copyErr == nil {
		copyErr = closeErr
	}
	if copyErr != nil {
		return copyErr
	}
	if written > maxBytes {
		return fmt.Errorf("audio exceeds %d byte limit", maxBytes)
	}

	file, err := os.Open(name)
	if err != nil {
		return err
	}
	defer file.Close()
	response, err := c.signedRequest(ctx, http.MethodPut, key, nil, file, contentType, hex.EncodeToString(hasher.Sum(nil)))
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode/100 != 2 {
		return responseError(response)
	}
	return nil
}

func (c *Client) Head(ctx context.Context, key string) (bool, error) {
	response, err := c.signedRequest(ctx, http.MethodHead, key, nil, nil, "", emptySHA256)
	if err != nil {
		return false, err
	}
	defer response.Body.Close()
	if response.StatusCode == http.StatusNotFound {
		return false, nil
	}
	if response.StatusCode/100 != 2 {
		return false, responseError(response)
	}
	return true, nil
}

func (c *Client) Delete(ctx context.Context, key string) error {
	response, err := c.signedRequest(ctx, http.MethodDelete, key, nil, nil, "", emptySHA256)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode/100 != 2 && response.StatusCode != http.StatusNotFound {
		return responseError(response)
	}
	return nil
}

func (c *Client) List(ctx context.Context, prefix string) ([]Object, error) {
	var objects []Object
	continuation := ""
	for {
		query := url.Values{"list-type": {"2"}, "prefix": {prefix}, "max-keys": {"1000"}}
		if continuation != "" {
			query.Set("continuation-token", continuation)
		}
		response, err := c.signedRequest(ctx, http.MethodGet, "", query, nil, "", emptySHA256)
		if err != nil {
			return nil, err
		}
		var page struct {
			IsTruncated bool   `xml:"IsTruncated"`
			Next        string `xml:"NextContinuationToken"`
			Contents    []struct {
				Key      string    `xml:"Key"`
				Size     int64     `xml:"Size"`
				Modified time.Time `xml:"LastModified"`
			} `xml:"Contents"`
		}
		if response.StatusCode/100 != 2 {
			err = responseError(response)
		} else {
			err = xml.NewDecoder(io.LimitReader(response.Body, 8<<20)).Decode(&page)
		}
		response.Body.Close()
		if err != nil {
			return nil, err
		}
		for _, item := range page.Contents {
			objects = append(objects, Object{Key: item.Key, Size: item.Size, LastModified: item.Modified})
		}
		if !page.IsTruncated || page.Next == "" {
			break
		}
		continuation = page.Next
	}
	sort.Slice(objects, func(i, j int) bool { return objects[i].Key < objects[j].Key })
	return objects, nil
}

func (c *Client) signedRequest(ctx context.Context, method, key string, query url.Values, body io.Reader, contentType, payloadHash string) (*http.Response, error) {
	u := c.objectURL(key)
	if query != nil {
		u.RawQuery = query.Encode()
	}
	request, err := http.NewRequestWithContext(ctx, method, u.String(), body)
	if err != nil {
		return nil, err
	}
	if file, ok := body.(*os.File); ok {
		if info, statErr := file.Stat(); statErr == nil {
			request.ContentLength = info.Size()
		}
	}
	if contentType != "" {
		request.Header.Set("Content-Type", contentType)
	}
	now := time.Now().UTC()
	request.Header.Set("X-Amz-Date", now.Format("20060102T150405Z"))
	request.Header.Set("X-Amz-Content-Sha256", payloadHash)
	request.Header.Set("Authorization", c.authorization(request, now, payloadHash))
	return c.http.Do(request)
}

func (c *Client) authorization(request *http.Request, now time.Time, payloadHash string) string {
	headerNames := []string{"host", "x-amz-content-sha256", "x-amz-date"}
	if request.Header.Get("Content-Type") != "" {
		headerNames = append([]string{"content-type"}, headerNames...)
	}
	canonicalHeaders := ""
	for _, name := range headerNames {
		value := request.Header.Get(name)
		if name == "host" {
			value = request.URL.Host
		}
		canonicalHeaders += name + ":" + strings.TrimSpace(value) + "\n"
	}
	signedHeaders := strings.Join(headerNames, ";")
	canonical := strings.Join([]string{request.Method, request.URL.EscapedPath(), request.URL.Query().Encode(), canonicalHeaders, signedHeaders, payloadHash}, "\n")
	scope := now.Format("20060102") + "/" + c.region + "/s3/aws4_request"
	signature := hex.EncodeToString(hmacSHA(signingKey(c.secretKey, now, c.region), signatureString(now, scope, canonical)))
	return "AWS4-HMAC-SHA256 Credential=" + c.accessKey + "/" + scope + ", SignedHeaders=" + signedHeaders + ", Signature=" + signature
}

func (c *Client) objectURL(key string) *url.URL {
	u := *c.endpoint
	u.Path = path.Join(c.endpoint.Path, c.bucket, key)
	if key == "" {
		u.Path += "/"
	}
	return &u
}

func signatureString(now time.Time, scope, canonical string) string {
	hash := sha256.Sum256([]byte(canonical))
	return "AWS4-HMAC-SHA256\n" + now.Format("20060102T150405Z") + "\n" + scope + "\n" + hex.EncodeToString(hash[:])
}
func signingKey(secret string, now time.Time, region string) []byte {
	date := hmacSHA([]byte("AWS4"+secret), now.Format("20060102"))
	regionKey := hmacSHA(date, region)
	service := hmacSHA(regionKey, "s3")
	return hmacSHA(service, "aws4_request")
}
func hmacSHA(key []byte, data string) []byte {
	h := hmac.New(sha256.New, key)
	_, _ = h.Write([]byte(data))
	return h.Sum(nil)
}

func responseError(response *http.Response) error {
	data, _ := io.ReadAll(io.LimitReader(response.Body, 4096))
	return fmt.Errorf("object storage HTTP %d: %s", response.StatusCode, strings.TrimSpace(string(data)))
}

const emptySHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
