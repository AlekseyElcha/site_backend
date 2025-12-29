"""
Утилиты для работы с временными зонами
"""

from datetime import datetime, timezone, timedelta

# Московское время (UTC+3)
MOSCOW_TZ = timezone(timedelta(hours=3))

def get_moscow_time() -> datetime:
    """Получить текущее время в московской временной зоне (UTC+3)"""
    return datetime.now(MOSCOW_TZ)

def get_moscow_time_iso() -> str:
    """Получить текущее время в московской временной зоне в формате ISO"""
    return get_moscow_time().isoformat()

def to_moscow_time(dt: datetime) -> datetime:
    """Конвертировать datetime в московское время"""
    if dt.tzinfo is None:
        # Если время без временной зоны, считаем его UTC
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(MOSCOW_TZ)

def to_moscow_time_iso(dt: datetime) -> str:
    """Конвертировать datetime в московское время в формате ISO"""
    return to_moscow_time(dt).isoformat()

def parse_iso_to_moscow(iso_string: str) -> datetime:
    """Парсить ISO строку и конвертировать в московское время"""
    dt = datetime.fromisoformat(iso_string.replace('Z', '+00:00'))
    return to_moscow_time(dt)