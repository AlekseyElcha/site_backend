/**
 * Утилиты для работы с временными зонами
 */

// Московская временная зона (UTC+3)
const MOSCOW_OFFSET = 3 * 60; // 3 часа в минутах

/**
 * Получить текущее московское время
 */
function getMoscowTime() {
    const now = new Date();
    const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
    return new Date(utc + (MOSCOW_OFFSET * 60000));
}

/**
 * Конвертировать дату в московское время
 */
function toMoscowTime(date) {
    if (typeof date === 'string') {
        date = new Date(date);
    }
    
    // Если дата уже содержит информацию о временной зоне, используем её
    if (date.toISOString().includes('T') && (date.toISOString().includes('+') || date.toISOString().includes('Z'))) {
        // Создаем новую дату в московском времени
        const moscowTime = new Date(date.toLocaleString("en-US", {timeZone: "Europe/Moscow"}));
        return moscowTime;
    }
    
    // Если дата без временной зоны, считаем её UTC и конвертируем
    const utc = date.getTime();
    return new Date(utc + (MOSCOW_OFFSET * 60000));
}

/**
 * Форматировать время для отображения в чате
 */
function formatChatTime(timestamp) {
    let date;
    
    if (typeof timestamp === 'string') {
        date = new Date(timestamp);
    } else {
        date = timestamp;
    }
    
    // Если дата содержит информацию о временной зоне, используем её как есть
    // Иначе конвертируем в московское время
    if (!timestamp.includes('+') && !timestamp.includes('Z')) {
        date = toMoscowTime(date);
    }
    
    const timeStr = date.toLocaleTimeString('ru-RU', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Europe/Moscow'
    });
    
    const dateStr = date.toLocaleDateString('ru-RU', {
        day: '2-digit',
        month: '2-digit',
        timeZone: 'Europe/Moscow'
    });
    
    return { timeStr, dateStr };
}

/**
 * Получить текущее время в формате ISO для московской зоны
 */
function getMoscowTimeISO() {
    return getMoscowTime().toISOString();
}

// Экспортируем функции
window.getMoscowTime = getMoscowTime;
window.toMoscowTime = toMoscowTime;
window.formatChatTime = formatChatTime;
window.getMoscowTimeISO = getMoscowTimeISO;