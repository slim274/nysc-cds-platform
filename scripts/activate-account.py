import json
import getpass
import re
import sys
import urllib.request
import urllib.error

EMAIL = (sys.argv[1].strip().lower() if len(sys.argv) > 1 else "")
API_URL = "http://localhost:3001/auth/activate"

if not EMAIL:
    print("Usage: python3 scripts/activate-account.py <account-email>")
    raise SystemExit(1)

token = getpass.getpass("Paste activation token: ").strip()

if not re.fullmatch(r"[0-9a-fA-F]{64}", token):
    print("Invalid token. Expected 64 hexadecimal characters.")
    raise SystemExit(1)

password = getpass.getpass("Create account password (minimum 12 characters): ")
confirm = getpass.getpass("Confirm account password: ")

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
