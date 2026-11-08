from __future__ import annotations

import base64
import hashlib
import os

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from app.config import DATA_DIR, MASTER_KEY_FILE


def load_master_key() -> bytes:
    """Читает мастер-ключ из env или создаёт локальный файл (не коммитится)."""
    env_key = os.getenv("DCLOUD_MASTER_KEY")
    if env_key:
        key = base64.b64decode(env_key)
        if len(key) != 32:
            raise ValueError("DCLOUD_MASTER_KEY must be 32 bytes in base64")
        return key

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    if MASTER_KEY_FILE.exists():
        return base64.b64decode(MASTER_KEY_FILE.read_text(encoding="utf-8").strip())

    key = AESGCM.generate_key(bit_length=256)
    MASTER_KEY_FILE.write_text(base64.b64encode(key).decode("ascii"), encoding="utf-8")
    return key


def encrypt_bytes(data: bytes, master_key: bytes) -> dict[str, str]:
    """Шифрует файл случайным DEK, DEK оборачивает мастер-ключом."""
    dek = AESGCM.generate_key(bit_length=256)
    data_nonce = os.urandom(12)
    ciphertext = AESGCM(dek).encrypt(data_nonce, data, None)

    wrap_nonce = os.urandom(12)
    wrapped_dek = AESGCM(master_key).encrypt(wrap_nonce, dek, None)

    return {
        "ciphertext": ciphertext,
        "data_nonce": base64.b64encode(data_nonce).decode("ascii"),
        "key_wrapped": base64.b64encode(wrapped_dek).decode("ascii"),
        "key_nonce": base64.b64encode(wrap_nonce).decode("ascii"),
        "sha256": hashlib.sha256(data).hexdigest(),
    }


def decrypt_bytes(
    ciphertext: bytes,
    data_nonce: str,
    key_wrapped: str,
    key_nonce: str,
    master_key: bytes,
) -> bytes:
    """Расшифровывает файл: сначала DEK, затем данные."""
    dek = AESGCM(master_key).decrypt(
        base64.b64decode(key_nonce), base64.b64decode(key_wrapped), None
    )
    return AESGCM(dek).decrypt(base64.b64decode(data_nonce), ciphertext, None)
