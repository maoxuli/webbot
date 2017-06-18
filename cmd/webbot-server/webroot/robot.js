
class Robot {
	
	constructor(clientURL, videoURL, view, chatInput) {
		this.clientURL = clientURL;
		this.videoURL = videoURL;
		this.view = view; 
		this.capMap = {};
		this.ctrlMap = {};
		this.lsh = 0; 
		this.lsl = 0; 
		this.chatInput = chatInput;
		this.activeUsers = {}; 
		this.vs = null;
		this.jsmpeg = null;  
		this.infoCapz = 0; 
		this.reconnect = true;
		this.post = false;
		this.initDone = false;
		this.dcnotify = false; 
		this.col = 0; 
		this.coh = 0; 
	}

	Destroy() {

		this.reconnect = false; 

		var elem = document.getElementById("chatLog");
		if( elem != undefined && elem != null ) { 
			var children = elem.children;
			while( (children != undefined && children != null ) && children.length > 0 ) {
				elem.removeChild(elem.firstChild);    
				children = elem.children;
			}
		}

		if(this.ws != undefined && this.ws != null) {
			this.ws.onclose = {};
			this.ws.close(); 
		}	
	
		if(this.jsmpeg != undefined && this.jsmpeg != null) { 
			this.jsmpeg.destroy();
			this.jsmpeg = null; 
		}

		var view = document.getElementById("view"); 
		while (view != undefined && view != null && view.firstChild) {
			view.removeChild(view.firstChild);
		}
		
	}

	Connect() {
	
		this.ws = new WebSocket(this.clientURL); 
		this.ws.binaryType = 'arraybuffer';
		this.ws.robot = this; 
		this.ws.onopen = function() {
	
			this.robot.initDone = false;
			this.robot.infoCapz = 0; 
			var elem = document.getElementById("conStatus");
			if(elem) {
				elem.parentNode.removeChild(elem);
			}
		
			if(!this.robot.post) {
				this.robot.systemChat("help> ", "Type /help for information on commands."); 
				this.robot.post = true;	
			}
				
			this.robot.dcnotify = false; 
				
			this.robot.systemChat("status> ", "Connected."); 

		}
		
		this.ws.onmessage = function(e) {
			var data = e.data;
			var dv = new DataView(data);
			var type = dv.getUint32(0); 
			this.robot.handleMsg(type, data.slice(4)); 
		}
		
		this.ws.onclose = function() {
			this.robot.handleDissconnect();  
			if( !this.robot.dcnotify ) { 
				this.robot.systemChat("status> ", "Dissconnected."); 
				this.robot.dcnotify = true; 
			}
			if(this.robot.reconnect) { 
				var r = this.robot; 
				setTimeout(function() {
					r.Connect()
				}, 3);
			}
		}
	}

	handleMsg(id, msg) {

		switch(id) {
			case 1: 
				this.handleStatus(msg, true); 
				break;
			case 2: 
				this.handleStatus(msg, false); 
				break;
			case 3: 
				this.handleChatCap(msg); 
				break;
			case 4: 
				this.handleCookCap(msg); 
				break;
			case 5: 
				this.initDone = true; 
				break;
			case 100: 
				this.handleInfoCapDef(msg);
				break;
			case 101: 
				this.handleCtrlCapDef(msg); 
				break; 
			default: 
				if(this.capMap[id]) {
					this.capMap[id].function(this.capMap[id].cap, msg);
				} else {
					console.log("Unknown cap:", id);
				}
		}

	}

	handleDissconnect() {
			
		this.stopVideo(); 

		var view = document.getElementById("view"); 

		while (view.firstChild) {
			view.removeChild(view.firstChild);
		}

		this.capMap = {};
		this.ctrlMap = {};

		var c = document.getElementById("conStatus");
		if(!c) {
			c = document.createElement("canvas");
			c.id = "conStatus";
			c.width = 640; 
			c.height = 480; 

			var ctx = c.getContext("2d");

			var style = "position: absolute; left: 0; top: 0; z-index: 1;";
			c.setAttribute("style", style);
			view.appendChild(c); 
		}

		var ctx = c.getContext("2d");
		ctx.font = "12px Monospace";
		ctx.clearRect(0, 0, c.width, c.height);   

		ctx.fillStyle = "red";
		ctx.fillText("Disconnected", 5 , 472);
	}
	
	handleStatus(data, online) {

		var dv = new DataView(data);
		var th = dv.getUint32(0); 
		var tl = dv.getUint32(4); 

		if(this.lsh != 0 && this.lsl != 0 && this.lsh > th && this.lsl > tl ) {
			return
		}

		this.lsh = th; 
		this.lsl = tl;

		var view = document.getElementById("view"); 

		if(!online) { 
			while (view.firstChild) {
				view.removeChild(view.firstChild);
			}
			this.capMap = {};
			this.ctrlMap = {};
		}

		var c = document.getElementById("capStatus");
		if(!c) {
			c = document.createElement("canvas");
			c.id = "capStatus";
			c.width = 640; 
			c.height = 480; 

			var ctx = c.getContext("2d");
			var style = "position: absolute; left: 0; top: 0; z-index: 1;";
			c.setAttribute("style", style);
			view.appendChild(c); 
		}

		var ctx = c.getContext("2d");
		ctx.font = "12px Monospace";
		ctx.clearRect(0, 0, c.width, c.height);   

		if(online) {
			Robot.drawStatusText(c, "Robot Online", 5, 472, "#41F427"); 
			this.startVideo(); 
		} else {
			var ctx = c.getContext("2d");
			ctx.font = "12px Monospace";
			ctx.clearRect(0, 0, c.width, c.height);   
			ctx.fillStyle = "red";
			ctx.fillText("Robot Offline", 5 , 472);
			this.stopVideo(); 
		}
	}

	startVideo() {

		var view = document.getElementById("view"); 

		var c = document.createElement("canvas");
		c.width = 640; 
		c.height = 480; 

		var style = "position: relative; left: 0; top: 0; z-index: 0;";
		c.setAttribute("style", style);
		view.appendChild(c); 

		this.jsmpeg = new JSMpeg.Player(this.videoURL, {canvas: c, disableGl: false, pauseWhenHidden: false, chunkSize: 512 });
	
	}

	stopVideo() {

		if(this.jsmpeg == null) {
			return;
		}

		this.jsmpeg.destroy();
		this.jsmpeg = null; 
	}

	handleCookCap(data) {
		
		var dv = new DataView(data);
		var th = dv.getUint32(0); 
		var tl = dv.getUint32(4); 
		
		var msg = String.fromCharCode.apply(null, new Uint8Array(data.slice(12)));

		var d = new Date();
		d.setTime(d.getTime() + (30*24*60*60*1000));
		var expires = "expires="+d.toUTCString();
		document.cookie = "CHAT_NAME=" + msg + "; " + expires;
	}

	handleInfoCapDef(data) {

		var dv = new DataView(data);
		var id = dv.getUint32(0); 
		var v  = dv.getUint32(4); 
		var f  = dv.getUint32(8);
		var th = dv.getUint32(12); 
		var tl = dv.getUint32(16); 

		var msg = String.fromCharCode.apply(null, new Uint8Array(data.slice(20)));
		var cap = JSON.parse(msg);

		var c = document.createElement("canvas");
		c.id = "infoCap" + id;
		c.width = 640; 
		c.height = 480; 

		var ctx = c.getContext("2d");
		//ctx.translate(0.5, 0.5);

		ctx.mozImageSmoothingEnabled = false;
		ctx.webkitImageSmoothingEnabled = false;
		ctx.msImageSmoothingEnabled = false;
		ctx.imageSmoothingEnabled = false;

		this.infoCapz += 1
		var style = "position: absolute; left: 0; top: 0; z-index: " + this.infoCapz + ";";
		c.setAttribute("style", style);

		var view = document.getElementById("view"); 
		view.appendChild(c); 

		// If the one we have is newer lets keep that. 
		if(this.capMap[id] && this.capMap[id].th > th && this.capMap[id].tl > tl) {
			return
		}

		this.capMap[id] ={
			th: th, 
			tl: tl, 
			cth: 0, 
			ctl: 0, 
			cap: cap, 
			function: function(cap, data) {

				var dv = new DataView(data);
				var cth = dv.getUint32(0); 
				var ctl = dv.getUint32(4); 

				if( cap.cth > cth && cap.ctl > ctl) {
					return;
				}

				var msg = String.fromCharCode.apply(null, new Uint8Array(data.slice(8)));

				cap.cth = cth; 
				cap.ctl = ctl; 

				Robot.drawStatusTextID("infoCap"+id, cap.Lable + ": " +msg,cap.X, cap.Y, "white");
			}, 
		};
	}

	static drawStatusTextID(id, text, x, y, color) {
		var c = document.getElementById(id);
		Robot.drawStatusText(c, text, x, y, color); 
	}
	
	static drawStatusText(c, text, x, y, color) {

		var scale = 2; 
		var ocanvas = document.createElement('canvas');
		var octx = ocanvas.getContext('2d');

		ocanvas.width = c.width * scale; 
		ocanvas.height = c.height * scale;

		var fs = 14 * scale; 
		octx.font = "bold " + fs + "px Monospace";
		octx.strokeStyle = 'black';
		octx.lineWidth = 2;

		octx.strokeText(text, x*scale, y*scale);
		octx.fillStyle = color;
		octx.fillText(text, x*scale, y*scale);

		var ctx = c.getContext("2d");
		ctx.clearRect(0, 0, c.width, c.height);   
		ctx.drawImage(ocanvas, 0, 0, c.width, c.height);
	}

	static drawStatusTextNB(c, text, x, y, color) {

		var ctx = c.getContext("2d");

		ctx.font = "bold 14px Monospace";
		ctx.clearRect(0, 0, c.width, c.height);   
		ctx.fillStyle = color;
		ctx.fillText(text, x, y);
	}

	handleCtrlCapDef(data) {

		var dv = new DataView(data);
		var id = dv.getUint32(0); 
		var v  = dv.getUint32(4); 
		var f  = dv.getUint32(8);
		var th = dv.getUint32(12); 
		var tl = dv.getUint32(16); 

		var msg = String.fromCharCode.apply(null, new Uint8Array(data.slice(20)));
		var cap = JSON.parse(msg);

		// If the one we have is newer lets keep that. 
		if(this.capMap[id] && this.capMap[id].th > th && this.capMap[id].tl > tl) {
			return
		}

		this.capMap[id] ={
			th: th, 
			tl: tl, 
			cap: cap, 
		};

		this.ctrlMap[cap.KeyCode] ={
			id: id, 
			th: th, 
			tl: tl, 
			cap: cap, 
			down: false, 
		};

	}

	getUserName(idh, idl) {

		if( this.activeUsers[idh] != undefined && 
			this.activeUsers[idh][idl] != undefined ) {
			return this.activeUsers[idh][idl].name;
		}

		return "unknown"; 
	}

	handleChatCap(data) {

		var dv = new DataView(data);
		var coh = dv.getUint32(0); 
		var col = dv.getUint32(4); 


		coh += this.coh; 
		col += this.col;

		this.coh++; 
		this.col++;

		var str = String.fromCharCode.apply(null, new Uint8Array(data.slice(8)));
		var msg = JSON.parse(str);
	
		var elem = document.getElementById("chatLog");
		var children = elem.children;
	
		if( children.length > 100 ) {
			elem.removeChild(elem.firstChild);    
		}

		// THIS IS A HACK -- probably will be here forever now. 
		if( !msg.c &&  msg.m == " has joined." ) {
			if( this.activeUsers[msg.n] == undefined || this.activeUsers[msg.n] == null ) {
				this.activeUsers[msg.n] = 1; 
			} else {
				this.activeUsers[msg.n] += 1; 
				return;
			}
		}

		if( !msg.c &&  msg.m == " has parted." ) {
			if( !(this.activeUsers[msg.n] == undefined || this.activeUsers[msg.n] == null) ) {
				this.activeUsers[msg.n] -= 1; 
				if( this.activeUsers[msg.n] == 0 ) {
					if( this.initDone ) { 
						var r = this;
						setTimeout(function() {
							if( r.activeUsers[msg.n] == 0 ) { 
								delete r.activeUsers[msg.n];	
								r.insertChatSlow(msg.n, msg.m, coh, col, "chatLog", msg.c) 
							}

						}, 1000); 

						return;
					} else {
						console.log("SHOULD FUCKING DELETE"); 
						delete this.activeUsers[msg.n];	
					}
				} else {
					return; 
				}
			}
		}
		// END OF HACK it is safe now. 

		var lcoh = -1;
		var lcol = -1;
		if( children.length > 0 ) {
			var lastChild = elem.lastChild;
			lcoh = parseInt(lastChild.getAttribute("coh"));
			lcol = parseInt(lastChild.getAttribute("col"));
		}

		if( lcoh <= coh && lcol < col ) {
			this.insertChatFast(msg.n, msg.m, coh, col, "chatLog", msg.c) 
		} else { 
			this.insertChatSlow(msg.n, msg.m, coh, col, "chatLog", msg.c) 
		}
	}
	
	insertChatFast(n, msg, coh, col, type, isChat) {

		var elem = document.getElementById(type);

		var name = n; 
		if(isChat){
			name += ": "
		}

		var node = this.newChatNode(name, msg, false); 
		node.setAttribute("coh", coh); 
		node.setAttribute("col", col); 

		elem.appendChild(node); 
		elem.scrollTop = elem.scrollHeight;

	}

	insertChatSlow(n, msg, coh, col, type, isChat) {

		var elem = document.getElementById(type);
		var children = elem.children;
		
		var name = n; 
		if(isChat){
			name += ": "
		}
	
		var node = this.newChatNode(name, msg, false); 
		node.setAttribute("coh", coh); 
		node.setAttribute("col", col); 

		for(var i = 0; i < children.length; i++) {

			var lcoh = children[i].getAttribute("coh");
			if( lcoh == undefined || lcoh == null )
				lcoh = 0; 

			var lcol = children[i].getAttribute("col");
			if( lcol == undefined || lcol == null )
				lcol = 0; 
			
			var local = children[i].getAttribute("isLocal");
			if(local == undefined || local == null) 
				local = false

			if(local)
				continue;

			if(lcoh > coh && lcol > col) {
				elem.insertBefore(node, children[i]);
				elem.scrollTop = elem.scrollHeight;	
				return 
			}	
			if(lcoh == coh && lcol == col) {
				return
			}
		}

		elem.appendChild(node); 
		elem.scrollTop = elem.scrollHeight;

	}

	newChatNode(n, msg, local) {

		var node = document.createElement("div");
		var p = document.createElement("p");
		
		p.setAttribute("style", "margin: 0px;" );
		
		node.setAttribute("local", local); 
		
		var spanNodeName = document.createElement("span"); 
		spanNodeName.innerHTML = n;
		spanNodeName.setAttribute("style", "font-weight: bold;" );
		var spanNodeChat = document.createElement("span"); 
		spanNodeChat.innerHTML = msg; 
		p.appendChild(spanNodeName);
		p.appendChild(spanNodeChat);
		node.appendChild(p); 

		return node;
	}


	systemChat(name, msg) {
		var node = this.newChatNode(name, msg, true); 	
		var elem = document.getElementById("chatLog");
		elem.appendChild(node); 
		elem.scrollTop = elem.scrollHeight;
	}

	handleHelp() {
		
		this.systemChat("> ", "/help"); 
		this.systemChat("> ", "Displaying help text."); 
		
		this.systemChat("help> ", "command"); 
		this.systemChat("command> ", "/help - Displays this help text."); 
		this.systemChat("command> ", "/users - List users."); 
		this.systemChat("command> ", "/controls - List keyboard controls."); 
		this.systemChat("info> ", "You control the robot with keyboard shortcuts."); 

	}
	
	handleControls() {

		this.systemChat("> ", "/controls"); 
		this.systemChat("> ", "Listing keyboard controls."); 
		
		for (var key in this.ctrlMap) {
			if (!this.ctrlMap.hasOwnProperty(key)) {
				continue;
			}

			var cap = this.ctrlMap[key].cap; 

			if(cap.KeyCode < 8) 
				continue;

			var msg = ""; 

			if(cap.Alt) {
				msg = "alt"+msg; 
			}

			if(cap.Shift) {
				if(msg.length > 0)
					msg += "+"
				msg += "shift"; 
			}
			
			if(cap.Ctrl) {
				if(msg.length > 0)
					msg += "+"
				msg += "ctrl"; 
			}
				
			if(msg.length > 0)
				msg += "+"
	
			msg += getKeyName(cap.KeyCode); 
			
			if(cap.Help != undefined && cap.Help != null && cap.Help.length > 0)
				msg += " | " + cap.Help;	

			this.systemChat("control> ", msg); 

		}

	}

	sendChat() {
		
		if( document.getElementById(this.chatInput).innerHTML == "" ) {
			return;
		}

		var str = document.getElementById(this.chatInput).innerHTML.replace(/&nbsp;/gi, '');;

		if(str.startsWith("/help")) {
			this.handleHelp(); 
			document.getElementById(this.chatInput).innerHTML = ""; 
			return;
		}

		if(str.startsWith("/controls")) {
			this.handleControls(); 
			document.getElementById(this.chatInput).innerHTML = ""; 
			return;
		}

		var buf = new ArrayBuffer(8 + str.length*2);
		var dv = new DataView(buf);
		dv.setUint32(0, buf.byteLength - 4); 
		dv.setUint32(4, 3); // CHAT CAP

		for(var i = 0, len=str.length; i<len; i++) {
			dv.setUint16(8 + (i * 2),str.charCodeAt(i), true); 
		}

		this.ws.send(buf); 

		document.getElementById(this.chatInput).innerHTML = ""; 
	}

	handleKey(e, d) {
		
		var chatInput = document.getElementById(this.chatInput); 
			
		if(d && e.keyCode == 13) {
			if( chatInput.innerHTML != "" ) {
				e.preventDefault();
				this.sendChat(); 
				return;
			}
		}

		if( e.keyCode == 13 && chatInput == document.activeElement && chatInput.innerHTML == "" ) {
			e.preventDefault();
			return;
		}

		if( chatInput == document.activeElement && chatInput.innerHTML != "" ) {
			return;
		}
		
		if(this.ctrlMap[e.keyCode] && 
			this.ctrlMap[e.keyCode].cap.Alt == e.altKey && 
			this.ctrlMap[e.keyCode].cap.Ctrl == e.ctrlKey && 
			this.ctrlMap[e.keyCode].cap.Shift == e.shiftKey ) {
					
			e.preventDefault();

			if(this.ctrlMap[e.keyCode].down != d) { 

				this.ctrlMap[e.keyCode].down = d;
				if(this.ctrlMap[e.keyCode].cap.Toggle && !d) { 
					return;
				}

				var buf = new ArrayBuffer(16);
				var dv = new DataView(buf);
				dv.setUint32(0, 12); 
				dv.setUint32(4, 101); // CTRL CAP
				dv.setUint32(8, this.ctrlMap[e.keyCode].id); 
				if(d) { 
					dv.setUint32(12,1); 
				} else {
					dv.setUint32(12,0); 
				}
				this.ws.send(buf); 
			}	

			return;
		}
	
	}

}

function getKeyName(code) {

	switch(code) {
		
		case 8:
	        return 'backspace';
		case 9:
	        return 'tab';
		case 13:
	        return 'enter';
		case 16:
	        return 'shift';
		case 17:
	        return 'ctrl';
		case 18:
	        return 'alt';
		case 19:
	        return 'pause/break';
		case 20:
	        return 'caps lock';
		case 27:
	        return 'esc';
		case 32:
	        return 'space';
		case 33:
	        return 'page up';
		case 34:
	        return 'page down';
		case 35:
	        return 'end';
		case 36:
	        return 'home';
		case 37:
	        return 'left';
		case 38:
	        return 'up';
		case 39:
	        return 'right';
		case 40:
	        return 'down';
		case 45:
	        return 'insert';
		case 46:
	        return 'delete';
		case 65: 
			return 'a'; 
		case 66: 
			return 'b';
		case 67: 
			return "c"; 
		case 68: 
			return "d"; 
		case 69: 
			return "e"; 
		case 70: 
			return "f"; 
		case 71: 
			return "g"; 
		case 72: 
			return "h"; 
		case 73: 
			return "i"; 
		case 74: 
			return "j"; 
		case 75: 
			return "k"; 
		case 76: 
			return "l"; 
		case 77: 
			return "m"; 
		case 78: 
			return "n"; 
		case 79: 
			return "o"; 
		case 80: 
			return "p"; 
		case 81: 
			return "q"; 
		case 82: 
			return "r"; 
		case 83: 
			return "s"; 
		case 84: 
			return "t"; 
		case 85: 
			return "u"; 
		case 86: 
			return "v"; 
		case 87: 
			return "w"; 
		case 88: 
			return "x"; 
		case 89: 
			return "y"; 
		case 90: 
			return "z"; 
		case 91:
	        return 'command';
		case 91:
	        return 'left command';
		case 93:
	        return 'right command';
		case 106:
	        return 'numpad *';
		case 107:
	        return 'numpad +';
		case 109:
	        return 'numpad -';
		case 110:
	        return 'numpad .';
		case 111:
	        return 'numpad /';
		case 144:
	        return 'num lock';
		case 145:
	        return 'scroll lock';
		case 182:
	        return 'my computer';
		case 183:
	        return 'my calculator';
		case 186:
	        return ';';
		case 187:
	        return '=';
		case 188:
	        return ',';
		case 189:
	        return '-';
		case 190:
	        return '.';
		case 191:
	        return '/';
		case 192:
	        return '`';
		case 219:
	        return '[';
		case 220:
	        return '\\';
		case 221:
	        return ']';
		case 222:
	        return "'";
	}


	if(code >= 48 && code < 58) 
		return code - 48; 


}
