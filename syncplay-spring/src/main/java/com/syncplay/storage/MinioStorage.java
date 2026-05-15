package com.syncplay.storage;

import io.minio.*;
import io.minio.errors.*;
import io.minio.http.Method;
import jakarta.annotation.PostConstruct;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.io.InputStream;
import java.security.InvalidKeyException;
import java.security.NoSuchAlgorithmException;
import java.util.UUID;
import java.util.concurrent.TimeUnit;

@Service
public class MinioStorage {

    @Value("${minio.endpoint}") private String endpoint;
    // If set, presigned URLs replace the internal endpoint with this public-facing one
    // so the browser can fetch audio directly from MinIO without the Spring→MinIO proxy hop.
    @Value("${minio.public-endpoint:}") private String publicEndpoint;
    @Value("${minio.access-key}") private String accessKey;
    @Value("${minio.secret-key}") private String secretKey;
    @Value("${minio.bucket}") private String bucket;

    private MinioClient client;

    @PostConstruct
    public void init() {
        client = MinioClient.builder().endpoint(endpoint).credentials(accessKey, secretKey).build();
        try {
            boolean exists = client.bucketExists(BucketExistsArgs.builder().bucket(bucket).build());
            if (!exists) client.makeBucket(MakeBucketArgs.builder().bucket(bucket).build());
        } catch (Exception e) {
            throw new RuntimeException("MinIO init failed", e);
        }
    }

    public String upload(InputStream input, long size, String contentType, String prefix, String ext) {
        String key = prefix + "/" + UUID.randomUUID() + (ext != null && !ext.isEmpty() ? "." + ext : "");
        try {
            client.putObject(PutObjectArgs.builder()
                .bucket(bucket).object(key)
                .stream(input, size, -1)
                .contentType(contentType).build());
            return key;
        } catch (Exception e) { throw new RuntimeException("Upload failed", e); }
    }

    public InputStream download(String key) {
        try { return client.getObject(GetObjectArgs.builder().bucket(bucket).object(key).build()); }
        catch (Exception e) { throw new RuntimeException("Download failed", e); }
    }

    public InputStream downloadRange(String key, long offset, long length) {
        try {
            return client.getObject(GetObjectArgs.builder()
                .bucket(bucket).object(key).offset(offset).length(length).build());
        } catch (Exception e) { throw new RuntimeException("Range download failed", e); }
    }

    public long size(String key) {
        try { return client.statObject(StatObjectArgs.builder().bucket(bucket).object(key).build()).size(); }
        catch (Exception e) { throw new RuntimeException("Stat failed", e); }
    }

    public String presignedGet(String key, int expirySeconds) {
        try {
            String url = client.getPresignedObjectUrl(GetPresignedObjectUrlArgs.builder()
                .method(Method.GET).bucket(bucket).object(key)
                .expiry(expirySeconds, TimeUnit.SECONDS).build());
            if (publicEndpoint != null && !publicEndpoint.isBlank()) {
                url = url.replace(endpoint, publicEndpoint);
            }
            return url;
        } catch (ErrorResponseException | InsufficientDataException | InternalException
                 | InvalidKeyException | InvalidResponseException | IOException
                 | NoSuchAlgorithmException | XmlParserException | ServerException e) {
            throw new RuntimeException("Presigned URL failed", e);
        }
    }

    public void delete(String key) {
        try { client.removeObject(RemoveObjectArgs.builder().bucket(bucket).object(key).build()); }
        catch (Exception ignore) {}
    }
}
