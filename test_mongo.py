"""Optional MongoDB Atlas connectivity smoke check.

Supply MONGODB_URI through the environment. Never store credentials in source.
This script is an opt-in connectivity example, not an application startup dependency.
"""
import os
import sys


def main() -> int:
    uri = os.environ.get("MONGODB_URI", "").strip()
    if not uri:
        print("MONGODB_URI is required for the MongoDB connectivity check.", file=sys.stderr)
        return 2

    try:
        from pymongo import MongoClient
    except ImportError:
        print("pymongo is required; install the optional requirements.txt dependencies.", file=sys.stderr)
        return 2

    client = MongoClient(
        uri,
        serverSelectionTimeoutMS=5000,
        connectTimeoutMS=5000,
    )
    try:
        client.admin.command("ping")
        print("MongoDB connectivity check passed.")
        return 0
    except Exception as exc:  # Connectivity failures are reported without printing the URI.
        print(f"MongoDB connectivity check failed ({type(exc).__name__}).", file=sys.stderr)
        return 1
    finally:
        client.close()


if __name__ == "__main__":
    raise SystemExit(main())
