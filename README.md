# ymodem
Implementation of Ymodem file transfer protocol over serial.
Based on [SerialApp](https://github.com/ppvision/SerialApp) project code

#### Install using NPM
```
npm install serialport
npm install fronders/ymodem
```

#### Usage example
For full example checkout [example.js](example\example.js)

```js
const fs = require('fs');
const SerialPort = require('serialport')
const YModem = require('ymodem');

var filePath = './firmware.bin';
var fileBuf = fs.readFileSync(filePath)
var serialPort = new serialPort.SerialPort('COM4', { autoOpen: false, baudrate: 115200 });

await YModem.transfer(serialPort, filePath, fileBuf).then((res) => {
	if (res && res.totalBytes == res.writtenBytes) {
		console.log('file transfer successful')
	} else {
		console.log('file transfer error')
	}
});
```

