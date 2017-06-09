package webbot

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"os"
	"os/exec"
	"sync"
	"sync/atomic"
	"time"
	"util"

	"golang.org/x/net/websocket"
)

const (
	ONLINE_CAP    = uint32(1)
	OFFLINE_CAP   = uint32(2)
	CHAT_CAP      = uint32(3)
	COOK_CAP      = uint32(4)
	DONE_CAP      = uint32(5)
	INFO_CAP      = uint32(100)
	CTRL_CAP      = uint32(101)
	USER_CAP      = uint32(102)
	VIDEO_CAP     = uint32(103)
	VIDEO_BUF_CAP = uint32(104)
)

type Robot struct {
	url      string
	key      string
	debug    bool
	nextID   uint32
	logger   *log.Logger
	videoDev string

	ffmpeg FFMPEG

	mu       sync.Mutex
	wg       sync.WaitGroup
	msgChan  chan []byte
	doneChan chan struct{}
	running  bool
	infoCap  []InfoCap
	ctrlCap  map[uint32]CtrlCap
	ctrlDef  map[uint32]CtrlCap

	videoLock    sync.Mutex
	videoLn      *net.TCPListener
	videoCmd     *exec.Cmd
	videoRunning bool
}

type FFMPEG struct {
	VideoDriver  string
	VideoOptions []string
	VideoDev     string
	AudioDriver  string
	AudioOptions []string
	AudioDev     string
}

func NewRobot(url, key string, ffmpeg FFMPEG, debug bool) *Robot {
	return &Robot{
		url:     url,
		key:     key,
		ffmpeg:  ffmpeg,
		debug:   debug,
		nextID:  1024,
		ctrlCap: make(map[uint32]CtrlCap),
		ctrlDef: make(map[uint32]CtrlCap),
		logger:  log.New(os.Stderr, "", log.LstdFlags),
	}
}

func (r *Robot) Run() error {

	r.logf("Connecting.")

	dc, err := websocket.NewConfig(r.url, r.url)
	if err != nil {
		return fmt.Errorf("Failed to get connection configuration: %v", err.Error())
	}
	dc.Header.Set("apikey", r.key)

	ws, err := websocket.DialConfig(dc)
	if err != nil {
		return fmt.Errorf("Failed to connect to server: %v", err.Error())
	}
	defer ws.Close()

	outDone := make(chan struct{}, 1)
	errChan := make(chan error, 1)

	r.logf("Setting up.")

	// Start all the processing threads.
	r.mu.Lock()
	r.msgChan = make(chan []byte, 1)
	r.doneChan = make(chan struct{})
	r.running = true
	r.wg.Add(1)
	r.mu.Unlock()

	go r.msgInHandler(ws, errChan)
	go r.msgOutHandler(ws, r.msgChan, outDone, errChan)
	go r.initCaps()

	r.logf("Running.")

	// Wait for a error on in and out handlers.
	err = <-errChan
	r.logf("Handler error: %v\n", err)

	// Start the shutdown process.
	close(outDone)

	drainChan := make(chan struct{})
	go r.drainChan(drainChan)

	r.logf("Shutting down video.")
	r.disableVideo()

	r.logf("Shutting down workers.")
	close(r.doneChan)

	r.logf("Changing state to not running.")
	r.mu.Lock()
	r.running = false
	r.mu.Unlock()

	r.logf("Waiting for workers to finish.\n")
	r.wg.Wait()

	r.logf("Shutting down message channel.\n")
	close(r.msgChan)

	r.logf("Waiting for channel drainer.\n")
	<-drainChan

	r.logf("Waiting for handler.\n")
	<-errChan

	r.logf("Robot connection shutdown.\n")
	return err
}

func (r *Robot) drainChan(done chan struct{}) {
	r.logf("Starting channel drain.")
	defer r.logf("Finished draining the channel.")
	for {
		select {
		case _, ok := <-r.msgChan:
			if !ok {
				close(done)
				return
			}
		}
	}
}

func (r *Robot) initCaps() {

	defer r.wg.Done()

	r.mu.Lock()
	for i := range r.infoCap {
		r.sendInfoCap(r.infoCap[i])
		r.runInfoCap(r.infoCap[i])
	}
	for k, _ := range r.ctrlCap {
		r.sendCtrlCap(r.ctrlCap[k])
	}
	r.mu.Unlock()
}

func (r *Robot) msgInHandler(ws *websocket.Conn, errChan chan error) {

	for {
		var msgSize uint32
		if err := binary.Read(ws, binary.BigEndian, &msgSize); err != nil {
			errChan <- fmt.Errorf("In Handler error: %v", err)
			return
		}

		if msgSize == 0 {
			r.logf("Message of size zero!\n")
			errChan <- fmt.Errorf("EOF zero size message.")
			return
		}

		msg := make([]byte, msgSize)
		if _, err := io.ReadFull(ws, msg); err != nil {
			errChan <- fmt.Errorf("In Handler error: %v", err)
			return
		}

		bb := bytes.NewBuffer(msg)

		var t uint32
		if err := binary.Read(bb, binary.BigEndian, &t); err != nil {
			// If this fails we are already in trouble.
			panic(fmt.Sprintf("Failed to read message of %v size from %v sized buffer:%v\n", 4, len(msg), err))
		}

		switch t {
		case CTRL_CAP: // ctrlcap
			r.handleCtrlCap(bb.Bytes())
		case VIDEO_CAP:
			r.handleVideoCap(bb.Bytes())
		default:
			r.logf("Unknown message type %v received.\n", t)
		}

	}
}

func (r *Robot) handleVideoCap(msg []byte) {

	bb := bytes.NewBuffer(msg)

	var e uint32
	if err := binary.Read(bb, binary.BigEndian, &e); err != nil {
		// If this fails we are already in trouble.
		panic(err)
	}

	enable := false
	if e > 0 {
		enable = true
	}

	r.logf("Video enable: %v\n", enable)

	if enable {
		r.enableVideo()
	} else {
		r.disableVideo()
	}
}

func (r *Robot) enableVideo() {

	r.logf("Enabling video.")

	r.mu.Lock()
	if !r.running {
		r.mu.Unlock()
		return
	}
	r.wg.Add(1)
	r.mu.Unlock()

	r.videoLock.Lock()
	defer r.videoLock.Unlock()

	ready := make(chan error, 1)
	go r.startVideoServer(ready)
	err := <-ready
	if err != nil {
		r.logf("Failed to start video server: %v\n", err)
		return
	}

	r.videoRunning = true

	go r.keepVideoRunning()
}

func (r *Robot) disableVideo() {

	r.logf("Disabling video.")

	r.videoLock.Lock()
	defer r.videoLock.Unlock()

	if !r.videoRunning {
		return
	}

	r.videoRunning = false

	if r.videoCmd != nil {
		r.videoCmd.Process.Kill()
		r.videoCmd = nil
	}

	if r.videoLn != nil {
		r.videoLn.Close()
	}
}

func (r *Robot) keepVideoRunning() {

	first := true
	for {
		r.videoLock.Lock()

		if !r.videoRunning {
			r.videoLock.Unlock()
			return
		}

		r.mu.Lock()
		if !r.running {
			r.mu.Unlock()
			r.videoLock.Unlock()
			return
		}
		r.mu.Unlock()

		if !first {
			r.logf("Restarting video.\n")
		} else {
			first = false
		}

		r.logf("Running video command.")

		args := make([]string, 0)

		args = append(args, "-loglevel", "8")
		args = append(args, "-f", r.ffmpeg.VideoDriver)
		args = append(args, "-framerate", "25", "-video_size", "640x480")
		args = append(args, r.ffmpeg.VideoOptions...)
		args = append(args, "-i", r.ffmpeg.VideoDev)

		if r.ffmpeg.AudioDriver != "" {
			args = append(args, "-f", r.ffmpeg.AudioDriver)
			args = append(args, r.ffmpeg.AudioOptions...)
			args = append(args, "-i", r.ffmpeg.AudioDev)
		}

		args = append(args, "-f", "mpegts")
		args = append(args, "-codec:v", "mpeg1video", "-s", "640x480", "-b:v", "384k", "-crf", "23", "-bf", "0")

		if r.ffmpeg.AudioDriver != "" {
			args = append(args, "-codec:a", "mp2", "-b:a", "32k")
			args = append(args, "-muxdelay", "0.001")
		}

		args = append(args, fmt.Sprintf("tcp://%v", r.videoLn.Addr().String()))

		c := exec.Command("ffmpeg", args...)

		c.Stdout = os.Stdout
		c.Stderr = os.Stderr

		if err := c.Start(); err != nil {
			r.logf("Video error: %v\n", err.Error())
		}

		r.videoCmd = c
		r.videoLock.Unlock()

		c.Wait()
	}
}

func (r *Robot) startVideoServer(ready chan error) {

	defer r.wg.Done()

	addrs := &net.TCPAddr{
		IP:   net.IPv4(127, 0, 0, 1),
		Port: 0,
	}

	ln, err := net.ListenTCP("tcp4", addrs)
	if err != nil {
		r.logf("Failed to bind to port: %v", err)
		ready <- err
		return
	}

	r.videoLn = ln
	ready <- nil

	// Non obvious, we really only want one connection...
	for {
		ln.SetDeadline(time.Now().Add(10 * time.Second))
		conn, err := ln.Accept()
		if err != nil {
			r.videoLock.Lock()
			if !r.videoRunning {
				r.videoLock.Unlock()
				return
			} else {
				r.logf("Failed to accept connection: %v", err)
			}
			r.videoLock.Unlock()
			return
		}

		r.mu.Lock()
		if !r.running {
			r.mu.Unlock()
			return
		}
		r.mu.Unlock()

		r.logf("Received video connection.")
		if err := r.handleVideoConnection(conn); err != nil {
			r.logf("Video connection failed: %v", err)
		}

	}

}

func (r *Robot) handleVideoConnection(conn net.Conn) error {

	defer conn.Close()

	buf := make([]byte, 512)

	for {
		conn.SetReadDeadline(time.Now().Add(5 * time.Second))
		size, err := conn.Read(buf)
		if err == io.EOF {
			return nil
		}

		if err != nil {
			return err
		}

		bb := bytes.NewBuffer(make([]byte, 0, size+4))

		t := VIDEO_BUF_CAP
		if err := binary.Write(bb, binary.BigEndian, t); err != nil {
			return fmt.Errorf("Failed to write message header to buffer: %v", err)

		}

		bb.Write(buf[:size])

		r.mu.Lock()
		if !r.running {
			r.mu.Unlock()
			return fmt.Errorf("Robot not running.")
		}
		r.msgChan <- bb.Bytes()
		r.mu.Unlock()
	}
}

func (r *Robot) handleCtrlCap(msg []byte) {

	bb := bytes.NewBuffer(msg)

	var group uint32
	if err := binary.Read(bb, binary.BigEndian, &group); err != nil {
		// If this fails we are already in trouble.
		panic(err)
	}

	var id uint32
	if err := binary.Read(bb, binary.BigEndian, &id); err != nil {
		// If this fails we are already in trouble.
		panic(err)
	}

	if id == 0 && group > 0 {
		cap, ok := r.ctrlDef[group]
		if !ok {
			r.logf("Could not find default control for group %v.\n", group)
			return
		}
		cap.callback()
		return
	}

	cap, ok := r.ctrlCap[id]
	if !ok {
		r.logf("Control enabled for unknown control %v.\n", id)
		return
	}
	cap.callback()

}

func (r *Robot) msgOutHandler(ws *websocket.Conn, msgChan <-chan []byte, done <-chan struct{}, errChan chan error) {

	defer r.logf("Leaving msgOutHandler")

	for {
		select {
		case msg := <-msgChan:
			if err := r.writeMsg(ws, msg); err != nil {
				errChan <- fmt.Errorf("Out Handler error: %v", err)
				return
			}
		case <-done:
			errChan <- nil
			return
		}
	}
}

// AddInfoCap adds the provided InfoCap to the robots info capabilities.
//
// AddInfoCap can be called at any time. If called before the running state the
// InfoCap definition will be saved and automatically sent to the server on
// connect. If called after in a running state the InfoCap will be sent to the
// server to notify it of the new capability.
func (r *Robot) AddInfoCap(infoCap InfoCap, c func() (string, error), d time.Duration) error {

	infoCap.callback = c
	infoCap.interval = d
	infoCap.id = atomic.AddUint32(&r.nextID, 1)
	infoCap.version = 1

	r.mu.Lock()
	defer r.mu.Unlock()

	r.infoCap = append(r.infoCap, infoCap)
	if err := r.sendInfoCap(infoCap); err != nil {
		return err
	}
	r.runInfoCap(infoCap)

	return nil
}

func (r *Robot) AddCtrlCap(ctrlCap CtrlCap, group uint32, d bool, c func() error) error {

	ctrlCap.callback = c
	ctrlCap.id = atomic.AddUint32(&r.nextID, 1)
	ctrlCap.version = 1
	ctrlCap.group = group

	if group > 0 && d {
		r.ctrlDef[group] = ctrlCap
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	r.ctrlCap[ctrlCap.id] = ctrlCap
	if err := r.sendCtrlCap(ctrlCap); err != nil {
		return err
	}

	return nil
}

func (r *Robot) sendInfoCap(infoCap InfoCap) error {

	if !r.running {
		return nil
	}

	if jsonBytes, err := json.Marshal(&infoCap); err != nil {
		return err
	} else {

		if buf, err := util.EncodeCapDef(
			INFO_CAP,
			infoCap.id,
			infoCap.version,
			infoCap.group,
			infoCap.revision,
			jsonBytes); err != nil {
			return err
		} else {
			r.msgChan <- buf
		}
	}

	return nil
}

func (r *Robot) sendCtrlCap(ctrlCap CtrlCap) error {

	if !r.running {
		return nil
	}

	if jsonBytes, err := json.Marshal(&ctrlCap); err != nil {
		return err
	} else {

		if buf, err := util.EncodeCapDef(
			CTRL_CAP,
			ctrlCap.id,
			ctrlCap.version,
			ctrlCap.group,
			ctrlCap.revision,
			jsonBytes); err != nil {
			return err
		} else {
			r.msgChan <- buf
		}
	}

	return nil
}

func (r *Robot) runInfoCap(infoCap InfoCap) {

	if !r.running {
		return
	}

	r.wg.Add(1)
	go infoCap.Run(&r.wg, r.msgChan, r.doneChan)
}

func (r *Robot) writeMsg(ws *websocket.Conn, msg []byte) error {
	return util.WriteMessage(ws, msg)
}

func (r *Robot) logf(format string, v ...interface{}) {
	if r.debug && r.logger != nil {
		r.logger.Printf(format, v...)
	}
}
