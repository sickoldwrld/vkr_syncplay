package com.syncplay.service;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.ObjectProvider;

import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class PlaybackSchedulerTest {

    @Test
    void schedule_fires_skipToNext_after_delay() throws Exception {
        var provider = stubProviderTo(callback -> {});
        PlaybackScheduler s = new PlaybackScheduler(provider.provider);

        UUID room = UUID.randomUUID();
        s.schedule(room, 50);

        assertThat(provider.latch.await(2, TimeUnit.SECONDS)).isTrue();
        assertThat(provider.callCount.get()).isEqualTo(1);
    }

    @Test
    void cancel_prevents_fire() throws Exception {
        var provider = stubProviderTo(callback -> {});
        PlaybackScheduler s = new PlaybackScheduler(provider.provider);

        UUID room = UUID.randomUUID();
        s.schedule(room, 200);
        s.cancel(room);

        // wait a bit longer than the delay
        Thread.sleep(400);
        assertThat(provider.callCount.get()).isZero();
    }

    @Test
    void reschedule_cancels_previous() throws Exception {
        var provider = stubProviderTo(callback -> {});
        PlaybackScheduler s = new PlaybackScheduler(provider.provider);

        UUID room = UUID.randomUUID();
        s.schedule(room, 50);
        s.schedule(room, 50); // should cancel the first

        Thread.sleep(300);
        assertThat(provider.callCount.get()).isEqualTo(1);
    }

    private record Stub(ObjectProvider<RoomService> provider, AtomicInteger callCount, CountDownLatch latch) {}

    @SuppressWarnings("unchecked")
    private Stub stubProviderTo(java.util.function.Consumer<Void> ignored) {
        AtomicInteger calls = new AtomicInteger();
        CountDownLatch latch = new CountDownLatch(1);
        RoomService roomService = mock(RoomService.class);
        org.mockito.Mockito.doAnswer(inv -> {
            calls.incrementAndGet();
            latch.countDown();
            return null;
        }).when(roomService).skipToNext(org.mockito.ArgumentMatchers.any(UUID.class));
        ObjectProvider<RoomService> p = mock(ObjectProvider.class);
        when(p.getObject()).thenReturn(roomService);
        return new Stub(p, calls, latch);
    }
}
