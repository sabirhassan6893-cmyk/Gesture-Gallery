const videoElement = document.getElementById('camera-feed');
const canvasElement = document.getElementById('camera-canvas');
const canvasCtx = canvasElement.getContext('2d');
const galleryContainer = document.getElementById('gallery-container');
const imageUpload = document.getElementById('image-upload');
const thumbCursor = document.getElementById('thumb-cursor');
const indexCursor = document.getElementById('index-cursor');

// Load 20 initial placeholder images
let images = [];
for (let i = 1; i <= 20; i++) {
    images.push(`https://picsum.photos/400/300?random=${i}`);
}

function addImageToGallery(src) {
    const frame = document.createElement('div');
    frame.className = 'picture-frame';
    
    const img = document.createElement('img');
    img.src = src;
    
    img.onerror = () => {
        img.src = 'https://placehold.co/400x300/e0e0e0/ffffff?text=Image+Missing';
    };

    frame.appendChild(img);
    
    // Position randomly but spread out over a wide area
    const maxW = window.innerWidth * 1.5;
    const maxH = window.innerHeight * 1.5;
    const offsetX = -window.innerWidth * 0.25;
    const offsetY = -window.innerHeight * 0.25;
    
    const x = Math.random() * maxW + offsetX;
    const y = Math.random() * maxH + offsetY;
    const rotation = (Math.random() - 0.5) * 40; 
    
    frame.style.left = `${x}px`;
    frame.style.top = `${y}px`;
    
    // Store rotation in dataset for easy manipulation later
    frame.dataset.rotation = rotation;
    frame.style.transform = `translate(-50%, -50%) rotate(${rotation}deg)`;
    
    galleryContainer.appendChild(frame);
}

// Initial setup
images.forEach(addImageToGallery);

// Handle Uploads
imageUpload.addEventListener('change', (e) => {
    const files = e.target.files;
    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const reader = new FileReader();
        reader.onload = (event) => {
            addImageToGallery(event.target.result);
        };
        reader.readAsDataURL(file);
    }
    // reset input
    e.target.value = '';
});

// Gesture State Variables
let isPinched = false;
let grabbedElement = null;
let grabOffsetX = 0;
let grabOffsetY = 0;
let grabStartHandAngle = 0;
let grabStartImageRotation = 0;

// Smoothing Variables
let smoothedMidX = null;
let smoothedMidY = null;
let smoothedDistance = null;
let smoothedAngle = null;
const SMOOTH_FACTOR = 0.35; // Lower is smoother but introduces slight lag

function onResults(results) {
    // Sync canvas size with video size once video is playing
    if (videoElement.videoWidth && canvasElement.width !== videoElement.videoWidth) {
        canvasElement.width = videoElement.videoWidth;
        canvasElement.height = videoElement.videoHeight;
    }

    canvasCtx.save();
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);

    if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
        const landmarks = results.multiHandLandmarks[0];

        // Determine if palm is facing the camera using a 2D cross product
        // This is mathematically robust and works regardless of how the hand is rotated.
        let isPalmFacingCamera = false;
        if (results.multiHandedness && results.multiHandedness.length > 0) {
            const handedness = results.multiHandedness[0].label; // "Left" or "Right"
            
            const wrist = landmarks[0];
            const middleMCP = landmarks[9];
            const thumbMCP = landmarks[2];
            
            // Vector A: Wrist to Middle MCP
            const Ax = middleMCP.x - wrist.x;
            const Ay = middleMCP.y - wrist.y;
            
            // Vector B: Wrist to Thumb MCP
            const Bx = thumbMCP.x - wrist.x;
            const By = thumbMCP.y - wrist.y;
            
            // 2D Cross Product of A and B
            const crossProduct = (Ax * By) - (Ay * Bx);
            
            // For a Right hand, palm facing camera yields a negative cross product.
            // For a Left hand, palm facing camera yields a positive cross product.
            if (handedness === 'Right') {
                isPalmFacingCamera = crossProduct < 0;
            } else {
                isPalmFacingCamera = crossProduct > 0;
            }
        }

        // Draw landmarks on the camera feed
        // Draw red if not facing camera, white if facing
        const landmarkColor = isPalmFacingCamera ? '#ffffff' : '#ff0000';
        drawConnectors(canvasCtx, landmarks, HAND_CONNECTIONS, {color: landmarkColor, lineWidth: 4});
        drawLandmarks(canvasCtx, landmarks, {color: landmarkColor, lineWidth: 2, fillColor: '#000000', radius: 4});

        if (isPalmFacingCamera) {
            const thumb = landmarks[4];
            const index = landmarks[8];
            const wrist = landmarks[0];
            const middleMCP = landmarks[9];

            // Map to screen coordinates (mirror horizontally)
            const screenThumbX = (1 - thumb.x) * window.innerWidth;
            const screenThumbY = thumb.y * window.innerHeight;

            const screenIndexX = (1 - index.x) * window.innerWidth;
            const screenIndexY = index.y * window.innerHeight;

            // Update cursors
            thumbCursor.style.display = 'block';
            thumbCursor.style.left = `${screenThumbX}px`;
            thumbCursor.style.top = `${screenThumbY}px`;

            indexCursor.style.display = 'block';
            indexCursor.style.left = `${screenIndexX}px`;
            indexCursor.style.top = `${screenIndexY}px`;

            // Screen distance between thumb and index
            const dx = screenIndexX - screenThumbX;
            const dy = screenIndexY - screenThumbY;
            const rawDistance = Math.sqrt(dx*dx + dy*dy);
            
            const rawMidX = (screenThumbX + screenIndexX) / 2;
            const rawMidY = (screenThumbY + screenIndexY) / 2;

            // Wrist angle for rotation
            const screenWristX = (1 - wrist.x) * window.innerWidth;
            const screenWristY = wrist.y * window.innerHeight;
            const screenMiddleMCPX = (1 - middleMCP.x) * window.innerWidth;
            const screenMiddleMCPY = middleMCP.y * window.innerHeight;
            const rawAngle = Math.atan2(screenMiddleMCPY - screenWristY, screenMiddleMCPX - screenWristX);

            // Exponential Smoothing
            if (smoothedMidX === null) {
                smoothedMidX = rawMidX;
                smoothedMidY = rawMidY;
                smoothedDistance = rawDistance;
                smoothedAngle = rawAngle;
            } else {
                smoothedMidX += (rawMidX - smoothedMidX) * SMOOTH_FACTOR;
                smoothedMidY += (rawMidY - smoothedMidY) * SMOOTH_FACTOR;
                smoothedDistance += (rawDistance - smoothedDistance) * SMOOTH_FACTOR;
                
                // Angle smoothing with wraparound handling
                let angleDiff = rawAngle - smoothedAngle;
                if (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
                if (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;
                smoothedAngle += angleDiff * SMOOTH_FACTOR;
            }

            const PINCH_THRESHOLD = 50; // pixels
            
            // Global z-index counter to keep track of stacking order
            if (typeof window.highestZIndex === 'undefined') {
                window.highestZIndex = 10;
            }

            // Hysteresis for pinch threshold to stop flickering state
            const pinchThresholdOffset = isPinched ? 15 : 0; 

            if (smoothedDistance < (PINCH_THRESHOLD + pinchThresholdOffset)) {
                if (!isPinched) {
                    // PINCH START
                    isPinched = true;
                    thumbCursor.classList.add('pinched');
                    indexCursor.classList.add('pinched');
                    
                    // Find element to grab using smoothed coords
                    const elementsUnderCursor = document.elementsFromPoint(smoothedMidX, smoothedMidY);
                    const img = elementsUnderCursor.find(el => el.tagName === 'IMG' && el.parentElement.classList.contains('picture-frame'));
                    
                    if (img) {
                        grabbedElement = img.parentElement;
                        grabbedElement.classList.add('grabbed');
                        
                        window.highestZIndex += 1;
                        grabbedElement.style.zIndex = window.highestZIndex;
                        
                        const currentLeft = parseFloat(grabbedElement.style.left) || 0;
                        const currentTop = parseFloat(grabbedElement.style.top) || 0;
                        grabOffsetX = currentLeft - smoothedMidX;
                        grabOffsetY = currentTop - smoothedMidY;
                        
                        grabStartHandAngle = smoothedAngle;
                        grabStartImageRotation = parseFloat(grabbedElement.dataset.rotation) || 0;
                    }
                } else if (grabbedElement) {
                    // PINCH DRAG
                    grabbedElement.style.left = `${smoothedMidX + grabOffsetX}px`;
                    grabbedElement.style.top = `${smoothedMidY + grabOffsetY}px`;
                    
                    // Smoothed wrist rotation
                    let deltaAngle = smoothedAngle - grabStartHandAngle;
                    
                    if (deltaAngle > Math.PI) deltaAngle -= 2*Math.PI;
                    if (deltaAngle < -Math.PI) deltaAngle += 2*Math.PI;
                    
                    const newRotation = grabStartImageRotation + (deltaAngle * 180 / Math.PI);
                    grabbedElement.dataset.rotation = newRotation;
                    grabbedElement.style.transform = `translate(-50%, -50%) rotate(${newRotation}deg)`;
                }
            } else {
                if (isPinched) {
                    // PINCH RELEASE (DROP)
                    isPinched = false;
                    thumbCursor.classList.remove('pinched');
                    indexCursor.classList.remove('pinched');
                    
                    if (grabbedElement) {
                        grabbedElement.classList.remove('grabbed');
                        grabbedElement = null;
                    }
                }
            }
        } else {
            // Hand is present but back is facing the camera
            // Hide cursors, drop image, and clear smoothing
            smoothedMidX = null;
            smoothedMidY = null;
            smoothedDistance = null;
            smoothedAngle = null;

            thumbCursor.style.display = 'none';
            indexCursor.style.display = 'none';
            
            if (isPinched) {
                isPinched = false;
                thumbCursor.classList.remove('pinched');
                indexCursor.classList.remove('pinched');
                if (grabbedElement) {
                    grabbedElement.classList.remove('grabbed');
                    grabbedElement = null;
                }
            }
        }
    } else {
        // No hands detected, clear smoothing and drop
        smoothedMidX = null;
        smoothedMidY = null;
        smoothedDistance = null;
        smoothedAngle = null;

        thumbCursor.style.display = 'none';
        indexCursor.style.display = 'none';
        
        if (isPinched) {
            isPinched = false;
            thumbCursor.classList.remove('pinched');
            indexCursor.classList.remove('pinched');
            if (grabbedElement) {
                grabbedElement.classList.remove('grabbed');
                grabbedElement = null;
            }
        }
    }
    
    canvasCtx.restore();
}

// Initialize MediaPipe Hands
const hands = new Hands({locateFile: (file) => {
  return `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`;
}});

hands.setOptions({
  maxNumHands: 1, 
  modelComplexity: 1,
  minDetectionConfidence: 0.7,
  minTrackingConfidence: 0.7
});

hands.onResults(onResults);

// Initialize Camera
const camera = new Camera(videoElement, {
  onFrame: async () => {
    await hands.send({image: videoElement});
  },
  width: 640,
  height: 480
});

camera.start().catch(err => {
    console.error("Camera error", err);
});
