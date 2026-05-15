package com.syncplay.model;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;
import java.time.LocalDateTime;
import java.util.UUID;

@Entity
@Table(name = "users")
@Getter @Setter
public class User {
    @Id @GeneratedValue
    private UUID id;
    @Column(unique = true, nullable = false, length = 50)
    private String username;
    @Column(unique = true, nullable = false, length = 100)
    private String email;
    @Column(nullable = false)
    private String password;
    @Column(name = "avatar_url")
    private String avatarUrl;
    @Column(name = "created_at", insertable = false, updatable = false)
    private LocalDateTime createdAt;
}
