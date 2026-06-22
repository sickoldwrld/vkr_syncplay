package com.syncplay.controller;

import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.security.core.AuthenticationException;
import org.springframework.web.bind.annotation.ControllerAdvice;
import org.springframework.web.bind.annotation.ExceptionHandler;

import java.util.Map;
import java.util.NoSuchElementException;

/**
 * Маппинг исключений на HTTP-статусы.
 * Раньше всё было 400 — отсюда путаница «неверный пароль выглядит как
 * некорректный запрос». Теперь у каждого типа свой код.
 */
@ControllerAdvice
public class GlobalExceptionHandler {

    @ExceptionHandler(IllegalArgumentException.class)
    public ResponseEntity<?> badRequest(IllegalArgumentException e) {
        return body(HttpStatus.BAD_REQUEST, e.getMessage());
    }

    /** Spring Security кидает это при неверных кредах или отсутствующем юзере. */
    @ExceptionHandler({ BadCredentialsException.class, AuthenticationException.class })
    public ResponseEntity<?> unauthorized(Exception e) {
        return body(HttpStatus.UNAUTHORIZED, "Неверный логин или пароль");
    }

    /** orElseThrow() из Optional → 404. */
    @ExceptionHandler(NoSuchElementException.class)
    public ResponseEntity<?> notFound(NoSuchElementException e) {
        String msg = e.getMessage() != null ? e.getMessage() : "Не найдено";
        return body(HttpStatus.NOT_FOUND, msg);
    }

    /** Нарушение unique-constraint и т.п. — обычно дубликат при регистрации. */
    @ExceptionHandler(DataIntegrityViolationException.class)
    public ResponseEntity<?> conflict(DataIntegrityViolationException e) {
        return body(HttpStatus.CONFLICT, "Конфликт данных — возможно, такой пользователь уже существует");
    }

    /**
     * Все прочие RuntimeException — это, скорее всего, баги или edge cases.
     * Раньше тоже шёл 400, что вводило клиента в заблуждение. Теперь — 500,
     * с сообщением для отладки.
     */
    @ExceptionHandler(RuntimeException.class)
    public ResponseEntity<?> runtime(RuntimeException e) {
        String msg = e.getMessage() != null ? e.getMessage() : "Внутренняя ошибка";
        // Особый случай: кастомные «Not authenticated» — это 401, не 500.
        if (msg.toLowerCase().contains("not authenticated")
            || msg.toLowerCase().contains("unauthorized")) {
            return body(HttpStatus.UNAUTHORIZED, msg);
        }
        if (msg.toLowerCase().contains("not found")) {
            return body(HttpStatus.NOT_FOUND, msg);
        }
        return body(HttpStatus.INTERNAL_SERVER_ERROR, msg);
    }

    private static ResponseEntity<?> body(HttpStatus status, String msg) {
        return ResponseEntity.status(status).body(Map.of("error", msg));
    }
}
