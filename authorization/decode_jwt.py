import json
import base64

def decode_jwt(token):
    """
    Декодирует JWT токен без проверки подписи
    """
    try:
        # Разделяем токен на части
        parts = token.split('.')
        if len(parts) != 3:
            raise ValueError("Неверный формат JWT токена")

        # Декодируем payload (вторая часть)
        payload_encoded = parts[1]
        # Добавляем padding если необходимо
        padding = '=' * (4 - len(payload_encoded) % 4) if len(payload_encoded) % 4 else ''
        payload_decoded = base64.urlsafe_b64decode(payload_encoded + padding)

        return json.loads(payload_decoded.decode('utf-8'))

    except Exception as e:
        print(f"Ошибка при декодировании токена: {e}")
        return None
