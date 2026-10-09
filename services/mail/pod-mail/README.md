# Mail Service

## Overview

The Mail Service is responsible for sending emails using SMTP or SES transfer.
It supports sending emails with multiple recipients, along with optional CC, BCC, and HTML content.

### Configuration

Environment variables should be set to configure the Mail Service:

- `PORT`: The port on which the mail service listens for incoming HTTP requests.
- `MAIL_AUTH_TOKEN`: Required. Shared secret clients must send as `Authorization: Bearer <token>`. If it is not set, the service rejects all requests (fail-closed). Other services (account, transactor, gmail) must use the same `MAIL_AUTH_TOKEN`.
- `API_KEY`: Deprecated alias for `MAIL_AUTH_TOKEN`.
- `SOURCE`: The sender source (fallback for when emails emit from the system).
- `REPLY_TO`: (optional) Email to use for replies (useful for uni-directional STMP setups where emails are only emitted, but not received).

Settings for SMTP or SES email service should be specified, simultaneous use of both protocols is not supported

SMTP settings:

- `SMTP_HOST`: Hostname of the SMTP server used for sending emails.
- `SMTP_PORT`: Port number of the SMTP server.
- `SMTP_USERNAME`: Username for authenticating with the SMTP server. Refer to your SMTP server documentation for the appropriate format.
- `SMTP_PASSWORD`: Password for authenticating with the SMTP server. Refer to your SMTP server documentation for the appropriate format.
- `SMTP_TLS_MODE` (Optional): TLS mode for SMTP connection. Default: 'upgrade'. Possible values:
  - `secure`: Always use TLS (implicit TLS)
  - `upgrade`: Start unencrypted, upgrade to TLS if supported (STARTTLS)
  - `ignore`: Do not use TLS (not recommended for production use)
- `SMTP_DEBUG_LOG` (Optional): Enable debug logging for SMTP connection. Set to 'true' to enable. Default: false
- `SMTP_ALLOW_SELF_SIGNED` (Optional): Allow self-signed certificates for TLS connections. Set to 'true' to enable (not recommended for production use). Default: false

SES settings:

- `SES_ACCESS_KEY`: AWS SES access key for authentication.
- `SES_SECRET_KEY`: AWS SES secret key for authentication.
- `SES_REGION`: AWS SES region where your SES service is hosted.

### Running the Service

Add .env file to the root of the project with the following content to add integration with fake SMTP server:

```
PORT=8097
SMTP_HOST="mail.smtpbucket.com"
SMTP_PORT=8025
```

To use the real SMTP server it is required to register an account in some email service provider and specify settings and credentials for it.

Start the service locally using:

```bash
rushx run-local
```

The service will run and listen for incoming requests on the configured port.

## API Endpoints

### POST /send

Send an email message.

#### Request Body

- `to`: Required. String or array of strings containing recipient email addresses.
- `text`: Required. String containing the plain text message body.
- `subject`: Required. String containing the email subject.
- `html`: Optional. String containing HTML message body.
- `from`: Optional. Sender's email address.
- `headers`: Optional. An object or array of additional header fields.
- `apiKey`: Deprecated, use the `Authorization: Bearer` header instead.
- `attachments`: Optional. Array of objects, each object can have the following fields:
  - `filename`: Filename to be reported as the name of the attached file. Use of unicode is allowed.
  - `contentType`: Optional. Content type for the attachment, if not set will be derived from the filename property.
  - `content`: Required. String contents of the attachment (use `encoding: "base64"` for binary data). `path`, `href` and `raw` are not supported: the service never reads local files or fetches URLs.
  - `contentDisposition`: Optional. Content disposition type for the attachment, defaults to ‘attachment’.
  - `cid`: Optional. Content id for using inline images in HTML message source.
  - `encoding`: Optional. If set and content is a string, then encodes the content to a Buffer using the specified encoding. Example values: ‘base64’, ‘hex’, ‘binary’ etc. Useful if you want to use binary attachments in a JSON formatted email object.

Request body example:

```
{
  "subject": "Test SMTP",
  "text": "My text",
  "from": "test1@example.com",
  "to": "test2@example.com",
  "attachments": [
    {
      "filename": "test.txt",
      "content": "Hello world",
      "contentType": "text/plain"
    }
  ]
}
```

#### Response

- `200 OK` on success.
- `400 Bad Request` if required fields are missing.
