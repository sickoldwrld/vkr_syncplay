package com.syncplay.service;

import com.syncplay.model.User;
import com.syncplay.repo.UserRepo;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.servlet.http.HttpSession;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContext;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.context.HttpSessionSecurityContextRepository;
import org.springframework.security.web.context.SecurityContextRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class AuthService {
    private final UserRepo userRepo;
    private final PasswordEncoder passwordEncoder;
    private final AuthenticationManager authManager;
    private final SecurityContextRepository contextRepo = new HttpSessionSecurityContextRepository();

    public AuthService(UserRepo userRepo, PasswordEncoder passwordEncoder, AuthenticationManager authManager) {
        this.userRepo = userRepo;
        this.passwordEncoder = passwordEncoder;
        this.authManager = authManager;
    }

    @Transactional
    public User register(String username, String email, String password) {
        if (username == null || username.trim().length() < 3) throw new IllegalArgumentException("Username min 3 chars");
        if (email == null || !email.contains("@")) throw new IllegalArgumentException("Invalid email");
        if (password == null || password.length() < 4) throw new IllegalArgumentException("Password min 4 chars");
        if (userRepo.existsByUsername(username)) throw new IllegalArgumentException("Username taken");
        if (userRepo.existsByEmail(email)) throw new IllegalArgumentException("Email taken");

        User u = new User();
        u.setUsername(username.trim());
        u.setEmail(email.trim());
        u.setPassword(passwordEncoder.encode(password));
        return userRepo.save(u);
    }

    /** Программный login — создаёт сессию и пишет SecurityContext в неё. */
    public void login(String username, String password, HttpServletRequest req, HttpServletResponse resp) {
        Authentication auth = authManager.authenticate(
            new UsernamePasswordAuthenticationToken(username, password));
        SecurityContext ctx = SecurityContextHolder.createEmptyContext();
        ctx.setAuthentication(auth);
        SecurityContextHolder.setContext(ctx);
        // Сохранить контекст в HTTP-сессии
        HttpSession session = req.getSession(true);
        session.setAttribute(HttpSessionSecurityContextRepository.SPRING_SECURITY_CONTEXT_KEY, ctx);
    }
}
