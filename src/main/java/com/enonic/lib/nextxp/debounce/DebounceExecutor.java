package com.enonic.lib.nextxp.debounce;

import java.util.concurrent.Callable;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;

public class DebounceExecutor
{
    private final ScheduledExecutorService executor;

    private ScheduledFuture<Object> future;

    public DebounceExecutor()
    {
        this.executor = Executors.newSingleThreadScheduledExecutor( r -> {
            Thread t = new Thread( r, "Debouncer" );
            t.setDaemon( true );
            return t;
        } );
    }

    public ScheduledFuture<Object> debounce( Callable<Object> task, long delay )
    {
        if ( this.future != null && !this.future.isDone() )
        {
            this.future.cancel( false );
        }

        return this.future = this.executor.schedule( task, delay, TimeUnit.MILLISECONDS );
    }
}