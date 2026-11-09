import json
import getpass
import urllib.request
import urllib.error
import http.cookiejar

EMAIL = "lgi.demo@example.test"
URL = "http://localhost:3001/auth/login"

password = getpass.getpass("Enter LGI password: ")

payload = {
    "email": EMAIL,
    "password": password
}

cookies = http.cookiejar.CookieJar()

opener = urllib.request.build_opener(
    urllib.request.HTTPCookieProcessor(cookies)
)

request = urllib.request.Request(
    URL,
    data=json.dumps(payload).encode(),
    headers={"Content-Type": "application/json"},
    method="POST"
)

try:
    with opener.open(request, timeout=15) as response:
        print("\nHTTP Status:", response.status)
        print("Response:", response.read().decode())

        print("\nSession cookie received:", bool(list(cookies)))

except urllib.error.HTTPError as error:
    print("\nHTTP Error:", error.code)
    print(error.read().decode())

except Exception as error:
    print("\nRequest failed:", error)

finally:
    password = ""
    payload.clear()
