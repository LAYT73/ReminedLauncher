package dev.remined.companion;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.security.SecureRandom;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.LinkedBlockingQueue;

/**
 * Localhost JSON-lines bridge to the Remined launcher (protocol v2, see README). Socket and disk errors
 * drop the client only; nothing here may throw into the game.
 */
final class Bridge {
    private static final int VERSION = 2;
    private static final int HELLO_TIMEOUT_MS = 5_000;
    private static final int MAX_LINE = 64 * 1024;
    private static final int OUT_CAPACITY = 64;
    private static final int PENDING_CAPACITY = 256;
    private static final long CONNECT_WAIT_MS = 10_000L;

    private final Companion owner;
    private final Reflect reflect;
    private final Ui ui;
    private final Hub hub;
    private final Path file;
    private final String token = newToken();
    private final BlockingQueue<Out> outQueue = new LinkedBlockingQueue<>(OUT_CAPACITY);
    private final ArrayDeque<Pending> pending = new ArrayDeque<>();

    private ServerSocket server;
    private volatile Conn current;

    Bridge(Companion owner, Reflect reflect, Path dir, Hub hub) {
        this.owner = owner;
        this.reflect = reflect;
        this.ui = new Ui(owner, reflect);
        this.hub = hub;
        this.file = dir.resolve("bridge.json");
    }

    void start() throws IOException {
        server = new ServerSocket(0, 4, InetAddress.getByName("127.0.0.1"));
        writeInfo(server.getLocalPort());
        if (hub != null) hub.setSender(this::fire);
        thread("remined-bridge", this::acceptLoop);
        thread("remined-bridge-writer", this::writeLoop);
        thread("remined-bridge-pending", this::pendingLoop);
    }

    private void writeInfo(int port) throws IOException {
        byte[] bytes = ("{\"v\":" + VERSION + ",\"port\":" + port + ",\"token\":\"" + token + "\"}\n")
            .getBytes(StandardCharsets.UTF_8);
        Files.createDirectories(file.getParent());
        Path tmp = file.resolveSibling(file.getFileName() + ".tmp");
        Files.write(tmp, bytes);
        try {
            Files.move(tmp, file, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
        } catch (AtomicMoveNotSupportedException e) {
            Files.move(tmp, file, StandardCopyOption.REPLACE_EXISTING);
        }
    }

    private void acceptLoop() {
        while (!server.isClosed()) {
            try {
                Socket s = server.accept();
                thread("remined-bridge-client", () -> serve(s));
            } catch (Throwable e) {
                owner.log("accept failed", e);
                try {
                    Thread.sleep(1_000L);
                } catch (InterruptedException ie) {
                    return;
                }
            }
        }
    }

    /** One client: hello, then read lines until EOF. A verified new client replaces the old one. */
    private void serve(Socket s) {
        Conn c = null;
        try {
            s.setSoTimeout(HELLO_TIMEOUT_MS);
            c = new Conn(s);
            BufferedReader in = new BufferedReader(new InputStreamReader(s.getInputStream(), StandardCharsets.UTF_8));
            Map<String, Object> hello = Json.parse(readLine(in));
            if (!"hello".equals(Protocol.str(hello, "t")) || !token.equals(Protocol.str(hello, "token"))) return;
            s.setSoTimeout(0);
            String st = reflect.strategy();
            if (!write(c, "{\"t\":\"hello\",\"v\":" + VERSION + ",\"strategy\":" + Snapshot.str(st == null ? "unresolved" : st) + "}")) return;
            Conn old = current;
            current = c;
            if (old != null) old.close();
            String line;
            while ((line = readLine(in)) != null) {
                try {
                    handle(c, Json.parse(line));
                } catch (Throwable e) {
                    owner.log("bad message", e);
                }
            }
        } catch (Throwable e) {
            // client went away or sent garbage: drop it
        } finally {
            if (c != null && current == c) {
                current = null;
                onClient("voice", () -> {
                    if (hub != null) {
                        hub.onVoice(Protocol.Voice.off());
                        hub.clearInvite();
                    }
                });
            }
            try {
                s.close();
            } catch (Throwable ignored) {
                // already closed
            }
        }
    }

    private void handle(Conn c, Map<String, Object> m) {
        String t = Protocol.str(m, "t");
        if (t == null) return;
        switch (t) {
            case "voice": {
                final Protocol.Voice v = Protocol.voice(m);
                onClient("voice", () -> {
                    if (hub != null) hub.onVoice(v);
                });
                break;
            }
            case "head": {
                final String id = Protocol.clip(Protocol.str(m, "id"), 64);
                final int[] px = Protocol.head(m);
                if (id == null || px == null) break;
                onClient("head", () -> {
                    if (hub != null) hub.onHead(id, px);
                });
                break;
            }
            case "notify": {
                final Protocol.Notice n = Protocol.notice(m);
                onClient("notify", () -> {
                    if (hub != null) hub.onNotify(n);
                });
                break;
            }
            case "connect": {
                final String host = Protocol.str(m, "host");
                final String name = Protocol.str(m, "name");
                final int port = (int) Protocol.num(m, "port", 0L);
                if (host == null || host.isEmpty() || port <= 0 || port > 65_535) {
                    send(c, connectResult("bad host or port"));
                    break;
                }
                try {
                    submit(new Pending("connect", () -> connectJob(c, host, port, name), c));
                } catch (Throwable e) {
                    send(c, connectResult("client not ready"));
                }
                break;
            }
            default:
                break;
        }
    }

    private void connectJob(Conn c, String host, int port, String name) {
        String res;
        try {
            ui.connect(host, port, name);
            res = connectResult(null);
        } catch (Throwable e) {
            res = connectResult(e.getMessage() != null ? e.getMessage() : e.getClass().getSimpleName());
        }
        send(c, res);
    }

    private static String connectResult(String error) {
        if (error == null) return "{\"t\":\"connect_result\",\"ok\":true}";
        return "{\"t\":\"connect_result\",\"ok\":false,\"error\":" + Snapshot.str(error) + "}";
    }

    /** Runs a job on the client thread; queued while the client is not ready. Failures are logged, never thrown. */
    private void onClient(String what, Task task) {
        try {
            submit(new Pending(what, task, null));
        } catch (Throwable e) {
            owner.log(what + " schedule failed", e);
        }
    }

    private interface Task {
        void run() throws Exception;
    }

    /** A client-thread job waiting for the Minecraft client. replyTo is set for connect, which must get a result. */
    private static final class Pending {
        final String what;
        final Task task;
        final Conn replyTo;
        final long since = System.currentTimeMillis();

        Pending(String what, Task task, Conn replyTo) {
            this.what = what;
            this.task = task;
            this.replyTo = replyTo;
        }
    }

    /** Runs p on the client thread now, or queues it (bounded, in arrival order) until the client is ready. */
    private void submit(Pending p) {
        synchronized (pending) {
            flushLocked();
            if (pending.isEmpty() && runOnClient(p)) return;
            if (pending.size() >= PENDING_CAPACITY) {
                owner.log("pending queue full", null);
                if (p.replyTo != null) send(p.replyTo, connectResult("client not ready"));
                return;
            }
            pending.addLast(p);
        }
    }

    private void pendingLoop() {
        while (true) {
            try {
                Thread.sleep(1_000L);
            } catch (InterruptedException e) {
                return;
            }
            synchronized (pending) {
                flushLocked();
            }
        }
    }

    /** Expires connects that waited too long, then runs queued jobs in order while the client is ready. Caller holds the lock. */
    private void flushLocked() {
        long now = System.currentTimeMillis();
        Iterator<Pending> it = pending.iterator();
        while (it.hasNext()) {
            Pending p = it.next();
            if (p.replyTo != null && now - p.since >= CONNECT_WAIT_MS) {
                it.remove();
                send(p.replyTo, connectResult("client not ready"));
            }
        }
        while (!pending.isEmpty() && runOnClient(pending.peekFirst())) pending.pollFirst();
    }

    /** Hands p to the client thread; false while the client is not ready (nothing scheduled). */
    private boolean runOnClient(Pending p) {
        try {
            return reflect.tryExecute(() -> runTask(p));
        } catch (Throwable e) {
            return false;
        }
    }

    private void runTask(Pending p) {
        try {
            p.task.run();
        } catch (Throwable e) {
            owner.log(p.what + " failed", e);
        }
    }

    /** Queues one line to the current client (keybind actions, connect results). Never blocks. */
    private void fire(String json) {
        Conn c = current;
        if (c != null) send(c, json);
    }

    /** Queues one line for the writer thread. Never blocks; drops when the queue is full or the client is gone. */
    private void send(Conn c, String json) {
        if (c != current) return;
        outQueue.offer(new Out(c, json));
    }

    private void writeLoop() {
        while (true) {
            Out o;
            try {
                o = outQueue.take();
            } catch (InterruptedException e) {
                return;
            }
            if (o.conn == current) write(o.conn, o.json);
        }
    }

    /** Writes one line. A write error drops the client; the bridge keeps running. */
    private boolean write(Conn c, String json) {
        try {
            synchronized (c) {
                c.out.write((json + "\n").getBytes(StandardCharsets.UTF_8));
                c.out.flush();
            }
            return true;
        } catch (Throwable e) {
            c.close();
            if (current == c) current = null;
            return false;
        }
    }

    /** Reads one line, failing when it exceeds MAX_LINE. Returns null at EOF. */
    private static String readLine(BufferedReader in) throws IOException {
        StringBuilder sb = new StringBuilder();
        int ch;
        while ((ch = in.read()) != -1) {
            if (ch == '\n') {
                int n = sb.length();
                if (n > 0 && sb.charAt(n - 1) == '\r') sb.setLength(n - 1);
                return sb.toString();
            }
            if (sb.length() >= MAX_LINE) throw new IOException("line too long");
            sb.append((char) ch);
        }
        return sb.length() == 0 ? null : sb.toString();
    }

    private static final class Out {
        final Conn conn;
        final String json;

        Out(Conn conn, String json) {
            this.conn = conn;
            this.json = json;
        }
    }

    private void thread(String name, Runnable r) {
        Thread t = new Thread(r, name);
        t.setDaemon(true);
        t.start();
    }

    private static String newToken() {
        byte[] b = new byte[16];
        new SecureRandom().nextBytes(b);
        StringBuilder sb = new StringBuilder(32);
        for (byte x : b) sb.append(String.format("%02x", x & 0xff));
        return sb.toString();
    }

    private static final class Conn {
        final Socket socket;
        final OutputStream out;

        Conn(Socket s) throws IOException {
            socket = s;
            out = s.getOutputStream();
        }

        void close() {
            try {
                socket.close();
            } catch (Throwable ignored) {
                // already closed
            }
        }
    }

    /** Minimal JSON parser: objects, arrays, strings, numbers, booleans and null. */
    static final class Json {
        private static final int MAX_DEPTH = 16;
        private final String s;
        private int i;
        private int depth;

        private Json(String s) {
            this.s = s;
        }

        static Map<String, Object> parse(String text) {
            if (text == null) throw new IllegalArgumentException("no input");
            Json p = new Json(text);
            p.ws();
            Map<String, Object> m = p.object();
            p.ws();
            if (p.i != text.length()) throw p.err();
            return m;
        }

        private Map<String, Object> object() {
            if (++depth > MAX_DEPTH) throw err();
            expect('{');
            Map<String, Object> m = new HashMap<>();
            ws();
            if (peek() == '}') {
                i++;
                depth--;
                return m;
            }
            while (true) {
                ws();
                String k = string();
                ws();
                expect(':');
                ws();
                m.put(k, value());
                ws();
                char c = next();
                if (c == '}') {
                    depth--;
                    return m;
                }
                if (c != ',') throw err();
            }
        }

        private List<Object> array() {
            if (++depth > MAX_DEPTH) throw err();
            expect('[');
            List<Object> l = new ArrayList<>();
            ws();
            if (peek() == ']') {
                i++;
                depth--;
                return l;
            }
            while (true) {
                ws();
                l.add(value());
                ws();
                char c = next();
                if (c == ']') {
                    depth--;
                    return l;
                }
                if (c != ',') throw err();
            }
        }

        private Object value() {
            char c = peek();
            if (c == '"') return string();
            if (c == '{') return object();
            if (c == '[') return array();
            if (c == 't') {
                lit("true");
                return Boolean.TRUE;
            }
            if (c == 'f') {
                lit("false");
                return Boolean.FALSE;
            }
            if (c == 'n') {
                lit("null");
                return null;
            }
            if (c == '-' || (c >= '0' && c <= '9')) return number();
            throw err();
        }

        private String string() {
            expect('"');
            StringBuilder sb = new StringBuilder();
            while (true) {
                char c = next();
                if (c == '"') return sb.toString();
                if (c != '\\') {
                    sb.append(c);
                    continue;
                }
                char e = next();
                switch (e) {
                    case '"': case '\\': case '/': sb.append(e); break;
                    case 'b': sb.append('\b'); break;
                    case 'f': sb.append('\f'); break;
                    case 'n': sb.append('\n'); break;
                    case 'r': sb.append('\r'); break;
                    case 't': sb.append('\t'); break;
                    case 'u': {
                        int v = 0;
                        for (int k = 0; k < 4; k++) {
                            int d = hex(next());
                            if (d < 0) throw err();
                            v = (v << 4) | d;
                        }
                        sb.append((char) v);
                        break;
                    }
                    default:
                        throw err();
                }
            }
        }

        private Object number() {
            int st = i;
            while (i < s.length() && "+-.eE0123456789".indexOf(s.charAt(i)) >= 0) i++;
            String t = s.substring(st, i);
            try {
                if (t.indexOf('.') >= 0 || t.indexOf('e') >= 0 || t.indexOf('E') >= 0) return Double.valueOf(t);
                return Long.valueOf(t);
            } catch (NumberFormatException e) {
                throw err();
            }
        }

        private void lit(String w) {
            if (!s.startsWith(w, i)) throw err();
            i += w.length();
        }

        private void ws() {
            while (i < s.length() && s.charAt(i) <= ' ') i++;
        }

        private char peek() {
            if (i >= s.length()) throw err();
            return s.charAt(i);
        }

        private char next() {
            if (i >= s.length()) throw err();
            return s.charAt(i++);
        }

        private static int hex(char c) {
            if (c >= '0' && c <= '9') return c - '0';
            if (c >= 'a' && c <= 'f') return c - 'a' + 10;
            if (c >= 'A' && c <= 'F') return c - 'A' + 10;
            return -1;
        }

        private void expect(char c) {
            if (next() != c) throw err();
        }

        private IllegalArgumentException err() {
            return new IllegalArgumentException("bad json at " + i);
        }
    }
}
