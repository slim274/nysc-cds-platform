import json
import getpass
import urllib.request
import urllib.error
import http.cookiejar

BASE_URL = "http://localhost:3001"

password = getpass.getpass("Enter LGI password: ")

cookies = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(
    urllib.request.HTTPCookieProcessor(cookies)
)

def request(method, path, payload=None):
    data = json.dumps(payload).encode() if payload else None

    req = urllib.request.Request(
        BASE_URL + path,
        data=data,
        headers={"Content-Type": "application/json"},
        method=method
    )

    try:
        with opener.open(req, timeout=15) as response:
            return response.status, response.read().decode()
    except urllib.error.HTTPError as error:
        return error.code, error.read().decode()

try:
    print("\n1. Testing LGI login...")
    status, body = request("POST", "/auth/login", {
        "email": "lgi.demo@example.test",
        "password": password
    })

    print(f"HTTP Status: {status}")
    print(body)

    if status != 200:
        raise SystemExit("Login failed.")

    print("\n2. Testing authenticated user...")
    status, body = request("GET", "/auth/me")
    print(f"HTTP Status: {status}")
    print(body)

    if status != 200:
        raise SystemExit("Authentication failed.")

    print("\n3. Testing LGI authorization...")
    status, body = request("GET", "/auth/lgi-check")
    print(f"HTTP Status: {status}")
    print(body)

    if status != 200:
        raise SystemExit("LGI authorization failed.")

    print("\n4. Testing logout...")
    status, body = request("POST", "/auth/logout")
    print(f"HTTP Status: {status}")
    print(body)

    if status != 200:
        raise SystemExit("Logout failed.")

    print("\n5. Testing access after logout...")
    status, body = request("GET", "/auth/me")
    print(f"HTTP Status: {status}")
    print(body)

    if status != 401:
        raise SystemExit("Session revocation test failed.")

    print("\n================================")
    print("ALL AUTHENTICATION TESTS PASSED")
    print("================================")

finally:
    password = ""
