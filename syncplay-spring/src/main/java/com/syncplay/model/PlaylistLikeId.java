package com.syncplay.model;
import lombok.AllArgsConstructor; import lombok.EqualsAndHashCode; import lombok.NoArgsConstructor;
import java.io.Serializable; import java.util.UUID;
@NoArgsConstructor @AllArgsConstructor @EqualsAndHashCode
public class PlaylistLikeId implements Serializable {
    private UUID userId;
    private UUID playlistId;
}
