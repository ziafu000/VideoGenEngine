// Proxy bridging Windows localhost Chrome DevTools (127.0.0.1:9222) to 0.0.0.0:9223 for WSL access
const net = require('net');

const server = net.createServer((clientSocket) => {
  const chromeSocket = net.connect(9222, '127.0.0.1');
  
  clientSocket.pipe(chromeSocket).pipe(clientSocket);
  
  chromeSocket.on('error', (err) => {
    // Nếu Chrome chưa bật hoặc bị tắt, ngắt kết nối ngay thay vì treo client
    clientSocket.destroy();
  });
  
  clientSocket.on('error', (err) => {
    chromeSocket.destroy();
  });
});

server.listen(9223, '0.0.0.0', () => {
  console.log('[CDP Proxy] Listening on 0.0.0.0:9223 -> 127.0.0.1:9222');
});
