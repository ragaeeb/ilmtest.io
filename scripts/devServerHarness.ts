const FETCH_TIMEOUT_MS = 10_000;

const waitForServer = async (baseUrl: string, server: Bun.Subprocess, timeoutMs = 30_000) => {
    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
        if (server.exitCode !== null) {
            throw new Error(`Dev server exited early while waiting for ${baseUrl}`);
        }

        try {
            const response = await fetch(new URL('/', baseUrl), {
                signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
            });
            if (response.ok) {
                return;
            }
        } catch {
            // Server is still starting.
        }

        await new Promise((resolve) => setTimeout(resolve, 500));
    }

    server.kill('SIGKILL');
    throw new Error(`Timed out waiting for dev server at ${baseUrl}`);
};

export const startAstroDevServer = async (port: number) => {
    const server = Bun.spawn(['bunx', 'astro', 'dev', '--host', '127.0.0.1', '--port', String(port)], {
        stdout: 'ignore',
        stderr: 'ignore',
        env: process.env,
    });
    const baseUrl = `http://127.0.0.1:${port}`;
    await waitForServer(baseUrl, server);

    return {
        baseUrl,
        dispose: async () => {
            server.kill('SIGKILL');
            await server.exited;
        },
    };
};
