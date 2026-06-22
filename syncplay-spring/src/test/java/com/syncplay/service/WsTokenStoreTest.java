package com.syncplay.service;

import org.junit.jupiter.api.Test;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

class WsTokenStoreTest {

    @Test
    void issued_token_resolves_to_user_once() {
        WsTokenStore store = new WsTokenStore();
        UUID uid = UUID.randomUUID();
        String token = store.issue(uid);

        assertThat(token).isNotBlank().hasSize(32);
        assertThat(store.consume(token)).isEqualTo(uid);
    }

    @Test
    void token_is_single_use() {
        WsTokenStore store = new WsTokenStore();
        UUID uid = UUID.randomUUID();
        String token = store.issue(uid);

        assertThat(store.consume(token)).isEqualTo(uid);
        // second consume must fail — single-use semantics protect against replay
        assertThat(store.consume(token)).isNull();
    }

    @Test
    void unknown_token_returns_null() {
        WsTokenStore store = new WsTokenStore();
        assertThat(store.consume("does-not-exist")).isNull();
    }

    @Test
    void null_token_returns_null() {
        WsTokenStore store = new WsTokenStore();
        assertThat(store.consume(null)).isNull();
    }

    @Test
    void each_issue_returns_unique_token() {
        WsTokenStore store = new WsTokenStore();
        UUID uid = UUID.randomUUID();
        String a = store.issue(uid);
        String b = store.issue(uid);
        assertThat(a).isNotEqualTo(b);
    }
}
