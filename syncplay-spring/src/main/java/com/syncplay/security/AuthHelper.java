package com.syncplay.security;

import org.springframework.security.core.context.SecurityContextHolder;
import java.util.UUID;

public class AuthHelper {
    public static UUID currentUserId() {
        var auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth == null || !auth.isAuthenticated()) return null;
        if (auth.getPrincipal() instanceof CustomUserDetails u) return u.getUserId();
        return null;
    }
}
