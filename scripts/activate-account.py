import json
import getpass
import re
import urllib.request
import urllib.error

EMAIL = "lgi.demo@example.test"
API_URL = "http://localhost:3001/auth/activate"

token = getpass.getpass("Paste LGI activation token: ").strip()

if not re.fullmatch(r"[0-9a-fA-F]{64}", token):
    print("Invalid token. Expected 64 hexadecimal characters.")
    raise SystemExit(1)

password = getpass.getpass("Create LGI password (minimum 12 characters): ")
confirm = getpass.getpass("Confirm LGI password: ")

if len(password) < 12 or len(password) > 128:
    print("Password must contain 12–128 characters.")
    raise SystemExit(1)

if password != confirm:
    print("Passwords do not match.")
    raise SystemExit(1)

payload = {
    "email": EMAIL,
    "token": token,
    "password": password
}

request = urllib.request.Request(
    API_URL,
    data=json.dumps(payload).encode(),
    headers={"Content-Type": "application/json"},
    method="POST"
)

try:
    with urllib.request.urlopen(request, timeout=15) as response:
        print("\nActivation response:")
        print(response.read().decode())

except urllib.error.HTTPError as error:
    print(f"\nHTTP Error: {error.code}")
    print(error.read().decode())

except Exception as error:
    print(f"\nRequest failed: {error}")

finally:
    token = ""
    password = ""
    confirm = ""
    payload.clear()
