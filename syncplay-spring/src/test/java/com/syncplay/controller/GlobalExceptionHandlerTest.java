package com.syncplay.controller;

import org.junit.jupiter.api.Test;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.authentication.BadCredentialsException;

import java.util.Map;
import java.util.NoSuchElementException;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Exhaustive coverage of the exception → HTTP status mapping. The frontend keys
 * off 401/403 specifically (redirect to /login), so the mapping is a contract.
 */
class GlobalExceptionHandlerTest {

    private final GlobalExceptionHandler handler = new GlobalExceptionHandler();

    @Test
    void illegal_argument_maps_to_400_with_message() {
        var resp = handler.badRequest(new IllegalArgumentException("bad email"));
        assertThat(resp.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(bodyError(resp)).isEqualTo("bad email");
    }

    @Test
    void bad_credentials_maps_to_401() {
        var resp = handler.unauthorized(new BadCredentialsException("bad"));
        assertThat(resp.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
        assertThat(bodyError(resp)).isEqualTo("Неверный логин или пароль");
    }

    @Test
    void no_such_element_maps_to_404() {
        var resp = handler.notFound(new NoSuchElementException("Track not found"));
        assertThat(resp.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
        assertThat(bodyError(resp)).isEqualTo("Track not found");
    }

    @Test
    void no_such_element_without_message_uses_default() {
        var resp = handler.notFound(new NoSuchElementException());
        assertThat(resp.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
        assertThat(bodyError(resp)).isEqualTo("Не найдено");
    }

    @Test
    void data_integrity_violation_maps_to_409() {
        var resp = handler.conflict(new DataIntegrityViolationException("dup"));
        assertThat(resp.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
    }

    @Test
    void runtime_with_not_authenticated_in_message_maps_to_401() {
        var resp = handler.runtime(new RuntimeException("Not authenticated"));
        assertThat(resp.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
    }

    @Test
    void runtime_with_not_found_in_message_maps_to_404() {
        var resp = handler.runtime(new RuntimeException("Room not found"));
        assertThat(resp.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
    }

    @Test
    void generic_runtime_maps_to_500() {
        var resp = handler.runtime(new RuntimeException("boom"));
        assertThat(resp.getStatusCode()).isEqualTo(HttpStatus.INTERNAL_SERVER_ERROR);
        assertThat(bodyError(resp)).isEqualTo("boom");
    }

    @SuppressWarnings("unchecked")
    private static String bodyError(ResponseEntity<?> r) {
        return (String) ((Map<String, Object>) r.getBody()).get("error");
    }
}
