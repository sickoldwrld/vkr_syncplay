package com.syncplay.service;

import com.syncplay.model.User;
import com.syncplay.repo.UserRepo;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.quality.Strictness;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.crypto.password.PasswordEncoder;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class AuthServiceTest {

    @Mock UserRepo userRepo;
    @Mock PasswordEncoder passwordEncoder;
    @Mock AuthenticationManager authManager;

    @InjectMocks AuthService authService;

    @BeforeEach
    void setUp() {
        when(passwordEncoder.encode(any())).thenReturn("$2a$hashed");
        when(userRepo.save(any(User.class))).thenAnswer(inv -> inv.getArgument(0));
    }

    @Test
    void register_persists_user_with_bcrypt_hashed_password() {
        var u = authService.register("alice", "alice@example.com", "pass1234");

        assertThat(u.getUsername()).isEqualTo("alice");
        assertThat(u.getEmail()).isEqualTo("alice@example.com");
        // password must NOT be persisted in plaintext
        assertThat(u.getPassword()).isEqualTo("$2a$hashed").isNotEqualTo("pass1234");
    }

    @Test
    void register_trims_whitespace_on_username_and_email() {
        var u = authService.register("  bob  ", "  bob@x.io  ", "secret");
        assertThat(u.getUsername()).isEqualTo("bob");
        assertThat(u.getEmail()).isEqualTo("bob@x.io");
    }

    @Test
    void register_rejects_short_username() {
        assertThatThrownBy(() -> authService.register("ab", "a@b.com", "secret"))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("Username");
    }

    @Test
    void register_rejects_invalid_email() {
        assertThatThrownBy(() -> authService.register("alice", "no-at-sign", "secret"))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("email");
    }

    @Test
    void register_rejects_short_password() {
        assertThatThrownBy(() -> authService.register("alice", "a@b.com", "abc"))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("Password");
    }

    @Test
    void register_rejects_taken_username() {
        when(userRepo.existsByUsername("alice")).thenReturn(true);
        assertThatThrownBy(() -> authService.register("alice", "a@b.com", "secret"))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("taken");
    }

    @Test
    void register_rejects_taken_email() {
        when(userRepo.existsByEmail("a@b.com")).thenReturn(true);
        assertThatThrownBy(() -> authService.register("alice", "a@b.com", "secret"))
            .isInstanceOf(IllegalArgumentException.class);
    }
}
