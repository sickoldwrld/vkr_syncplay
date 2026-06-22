package com.syncplay.service;

import com.syncplay.model.User;
import com.syncplay.repo.UserRepo;
import jakarta.annotation.PostConstruct;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;

/**
 * При первом запуске (когда таблица users пустая) создаёт демо-пользователя
 * чтобы можно было сразу войти, не дёргая /api/auth/register вручную.
 *
 * Управляется env-переменной DEMO_USER_ENABLED (по умолчанию true).
 * Username / password / email тоже из env, с разумными дефолтами.
 *
 * В production переменную ставят false или меняют дефолтный пароль.
 */
@Component
public class DemoUserSeeder {
    private static final Logger log = LoggerFactory.getLogger(DemoUserSeeder.class);

    private final UserRepo userRepo;
    private final PasswordEncoder passwordEncoder;

    @Value("${demo.user.enabled:true}")
    private boolean enabled;

    @Value("${demo.user.username:demo}")
    private String username;

    @Value("${demo.user.password:demo123}")
    private String password;

    @Value("${demo.user.email:demo@syncplay.local}")
    private String email;

    public DemoUserSeeder(UserRepo userRepo, PasswordEncoder passwordEncoder) {
        this.userRepo = userRepo;
        this.passwordEncoder = passwordEncoder;
    }

    @PostConstruct
    void seed() {
        if (!enabled) return;
        if (userRepo.count() > 0) {
            log.debug("Demo seed skipped — users table already has {} rows", userRepo.count());
            return;
        }
        User u = new User();
        u.setUsername(username);
        u.setEmail(email);
        u.setPassword(passwordEncoder.encode(password));
        userRepo.save(u);
        log.info("=========================================================");
        log.info("Создан демо-пользователь: username='{}' password='{}'", username, password);
        log.info("Чтобы отключить — установи DEMO_USER_ENABLED=false");
        log.info("=========================================================");
    }
}
