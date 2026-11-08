from __future__ import annotations

import hashlib

import pytest

from app.crypto import decrypt_bytes, encrypt_bytes


def test_encrypt_decrypt_roundtrip() -> None:
    master_key = b"m" * 32
    payload = b"secret DCloud payload" * 100
    encrypted = encrypt_bytes(payload, master_key)
    restored = decrypt_bytes(
        encrypted["ciphertext"],
        encrypted["data_nonce"],
        encrypted["key_wrapped"],
        encrypted["key_nonce"],
        master_key,
    )
    assert restored == payload
    assert encrypted["sha256"] == hashlib.sha256(payload).hexdigest()


def test_wrong_key_fails() -> None:
    encrypted = encrypt_bytes(b"payload", b"a" * 32)
    with pytest.raises(Exception):
        decrypt_bytes(
            encrypted["ciphertext"],
            encrypted["data_nonce"],
            encrypted["key_wrapped"],
            encrypted["key_nonce"],
            b"b" * 32,
        )


def test_tampered_ciphertext_fails() -> None:
    master_key = b"c" * 32
    encrypted = encrypt_bytes(b"payload", master_key)
    tampered = bytearray(encrypted["ciphertext"])
    tampered[0] ^= 1
    with pytest.raises(Exception):
        decrypt_bytes(
            bytes(tampered),
            encrypted["data_nonce"],
            encrypted["key_wrapped"],
            encrypted["key_nonce"],
            master_key,
        )
