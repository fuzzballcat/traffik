//p5.disableFriendlyErrors = true;

const GWIDTH = 21;
const GHEIGHT = 21;
const HALF_GWIDTH = Math.floor(GWIDTH/2);
const HALF_GHEIGHT = Math.floor(GHEIGHT/2);
const GX_OFFSET = ((GWIDTH+1)%2)/2;
const GY_OFFSET = ((GHEIGHT+1)%2)/2;
const GX_EXTRA = 0+!GX_OFFSET;
const GY_EXTRA = 0+!GY_OFFSET;
let roadsgrid = new Array(GWIDTH * GHEIGHT).fill().map(_=>0);
const xytoi = (x, y) => (y+HALF_GHEIGHT) * GWIDTH + (x+HALF_GWIDTH);
let intersectionsgrid = new Array(GWIDTH * GHEIGHT).fill().map(_=>false);
let intersections_coordinates = [];

const background_color = [255, 211, 153];
const unavailable_color = [255 * 0.9, 211 * 0.95, 153 * 0.99];

let ROADSIZE, CARX, CARY;
function calculateRoadScale(){
  ROADSIZE = Math.round(Math.min(window.innerWidth, window.innerHeight)*2/3 * 1/21);
  CARX = ROADSIZE/5*0.9;
  CARY = 2*CARX;
}
calculateRoadScale();

const CAR_DIESCALE = 10;
const CURVATURE = 1/3;

let buildings = [];
const TYPES_BUILDINGS = 5;
const BUILDINGS_COUNT = TYPES_BUILDINGS * 3;
const BUILDING_COLORS = [[255, 102, 71], [153, 214, 131], [152, 194, 237], [205, 141, 224], [255, 160, 43]];

const CARS_TIME_PER_ROADUNIT = 2*12;
const CARS_RESPAWN_TIME = 70;
const CAR_STREET_OFFSET = 0.15;

const MAX_DISSATISFACTION = 1;
const DIS_MIDPOINT = (-1 + MAX_DISSATISFACTION) / 2;
const DIS_RANGE = MAX_DISSATISFACTION - (-1);
const DIS_NORMALIZE = dis => (dis - DIS_MIDPOINT) / (DIS_RANGE/2);

let has_first_car = false;

let grainbuffer, grainshader, maincanvas;
const grainvert = `
precision highp float;
attribute vec3 aPosition;
attribute vec2 aTexCoord;

uniform mat4 uModelViewMatrix;
uniform mat4 uProjectionMatrix;

varying vec2 vTexCoord;

void main(void) {
  vec4 positionVec4 = vec4(aPosition, 1.0);
  gl_Position = uProjectionMatrix * uModelViewMatrix * positionVec4;
  vTexCoord = aTexCoord;
}
`;

const grainfrag = `
precision highp float;
varying vec2 vTexCoord;

uniform sampler2D source;
uniform float noiseSeed;
uniform float noiseAmount;

float rand(vec2 n) { 
  return fract(sin(dot(n, vec2(12.9898, 4.1414))) * 43758.5453);
}

void main() {
  vec4 inColor = texture2D(source, vTexCoord);
  gl_FragColor = vec4(inColor.xyz + noiseAmount * (rand(noiseSeed + vTexCoord * 876.321)-0.5), inColor.a);
}
`;

function applyGrain(){
  grainbuffer.clear();
  grainbuffer.shader(grainshader);
  grainshader.setUniform('noiseSeed', 0);
  grainshader.setUniform('source', maincanvas);
  grainshader.setUniform('noiseAmount', 0.2);
  grainbuffer.rect(0, 0, width, height);
  clear();
  image(grainbuffer, -width/2, -height/2);
}


function setup(){
  maincanvas = createCanvas(windowWidth, windowHeight);

  grainbuffer = createGraphics(width, height, WEBGL);
  grainbuffer.rectMode(CENTER)
  grainbuffer.noStroke();
  grainshader = grainbuffer.createShader(grainvert, grainfrag);

  rectMode(CENTER);

  for(let i = 0; i < BUILDINGS_COUNT; i ++){
    for(let _ = 0; _ < 1000; _ ++){
      let x = Math.trunc(Math.trunc(Math.random() * GWIDTH - HALF_GWIDTH)/2)*2,
          y = Math.trunc(Math.trunc(Math.random() * GHEIGHT - HALF_GHEIGHT)/2)*2;
      if(buildings.find(b => b.x === x && b.y === y)) continue;
      buildings.push({x, y, t: i % TYPES_BUILDINGS});
      break;
    }
  }
  for(let i = 0; i < TYPES_BUILDINGS; i ++){
    for(let _ = 0; _ < 1000; _ ++){
      let x = Math.trunc(Math.trunc(Math.random() * GWIDTH - HALF_GWIDTH)/2)*2,
          y = Math.trunc(Math.trunc(Math.random() * GHEIGHT - HALF_GHEIGHT)/2)*2;
      if(buildings.find(b => b.x === x && b.y === y)) continue;
      buildings.push({x, y, t: TYPES_BUILDINGS + i});
      break;
    }
  }

  textFont('Freeman');
  textAlign(CENTER, CENTER);
  textSize(40);
}

function astarHeuristic(p1, p2){
  return Math.abs(p2.x - p1.x) + Math.abs(p2.y - p1.y);
}

const noffsets = [{x: -1, y: 0}, {x: 0, y: -1}, {x: 1, y: 0}, {x: 0, y: 1}];
function searchAstar(startx, starty, endx, endy){
  if(!roadsgrid[xytoi(startx, starty)]) return false;

  let openset = [{x: startx, y: starty, f: 0, g: 0}];
  let closedset = [];
  let parents = [];
  for(let _ = 0; openset.length > 0 && _ < 1000; _++){
    let lowestindex = 0;
    for(let i = 0; i < openset.length; i ++){
      if(openset[i].f < openset[lowestindex].f) lowestindex = i;
    }
    let current = openset[lowestindex];
    if(current.x === endx && current.y === endy){ 
      let backtracking = {x: endx, y: endy};
      let path = [{...backtracking}];
      for(let i of parents){
        if(i.node.x === backtracking.x && i.node.y === backtracking.y){
          backtracking.x = i.parent.x;
          backtracking.y = i.parent.y;
          path.unshift({...backtracking});
        }
      }
      return path;
    }

    openset.splice(lowestindex, 1);
    closedset.push(current);
    // neighbors
    for(let o of noffsets){
      let neighbor = {x: current.x + o.x, y: current.y + o.y};
      if(neighbor.x < -HALF_GWIDTH || neighbor.y < -HALF_GHEIGHT || neighbor.x >= HALF_GWIDTH+GX_EXTRA || neighbor.y >= HALF_GHEIGHT+GY_EXTRA) continue;
      if(!roadsgrid[xytoi(neighbor.x, neighbor.y)]) continue;

      let isclosed = false;
      for(let i = 0 ; i < closedset.length; i ++){
        if(closedset[i].x === neighbor.x && closedset[i].y === neighbor.y) {
          isclosed = true;
          break;
        }
      }

      if(!isclosed){
        let possible_g = current.g + 1;

        let isopen = false;
        let inopenset_index;
        for(let i = 0 ; i < openset.length; i ++){
          if(openset[i].x === neighbor.x && openset[i].y === neighbor.y) {
            isopen = true;
            inopenset_index = i;
            break;
          }
        }
        if(!isopen) { inopenset_index = openset.length; openset.push({...neighbor}); }
        else if(possible_g >= openset[inopenset_index].g) continue;

        openset[inopenset_index].g = possible_g;
        openset[inopenset_index].f = possible_g + astarHeuristic(neighbor, {x: endx, y: endy});
        parents.unshift({node: {...neighbor}, parent: {...current}})
      }
    }
  }
  return false;
}

let cars = [];
let average_dissatisfaction = 0;
let frame_lost = false;

function draw(){
  let newcars = [];
  for(let c of cars){
    if(c.path.length <= 1 || (c.isdie !== false && c.isdie === 0)) continue;

    c.actual_time ++;

    if(c.isdie !== false) c.isdie = c.isdie + Math.floor((0 - c.isdie)/16);
    if(c.prc >= 0.99) {
      c.prc = 0;
      c.x = c.path[1].x;
      c.y = c.path[1].y;

      const old = c.path.shift();
      c.px = old.x;
      c.py = old.y;

      if(c.path.length == 1){
        c.nx = c.x - (c.px - c.x);
        c.ny = c.y - (c.py - c.y);
      } else {
        c.nx = c.path[1].x;
        c.ny = c.path[1].y;
      }
    }

    newcars.push(c);
  }
  cars = newcars;

  if(frameCount % CARS_RESPAWN_TIME === 0){
    for(let b of buildings){
      if(b.t < TYPES_BUILDINGS){
        if(cars.filter(c => c.x === b.x && c.y === b.y).length > 0) continue;
        let newcar = {x: b.x, y: b.y, t: b.t, r: 0, prc: 0.5, dx: 0, dy: 0, dvx: 0, dvy: 0, isct_waiting: false, isdie: false}; // dx dy dvx dvy isct_waiting update later
        const options = buildings.filter(b => b.t === newcar.t+TYPES_BUILDINGS);
        newcar.dest = options[Math.floor(Math.random() * options.length)];
        newcar.path = searchAstar(newcar.x, newcar.y, newcar.dest.x, newcar.dest.y);

        if(!newcar.path) continue;

        newcar.actual_time = 0;
        newcar.expected_time = Math.round((astarHeuristic(newcar.dest, newcar) + newcar.path.length)/2) * CARS_TIME_PER_ROADUNIT;

        newcar.nx = newcar.path[1].x;
        newcar.ny = newcar.path[1].y;
        newcar.px = newcar.x - (newcar.nx - newcar.x);
        newcar.py = newcar.y - (newcar.ny - newcar.y);
        cars.push(newcar);
        if(has_first_car === false) has_first_car = frameCount;
      }
    }
  }

  let dissatisfaction = cars.map(c => (c.actual_time - c.expected_time) / c.expected_time).reduce((a, b) => a+b, 0) / (cars.length||1);
  average_dissatisfaction += (dissatisfaction - average_dissatisfaction) / 256;

  background(255, 249, 207);

  if(has_first_car && frameCount > has_first_car+350){
    let offset = Math.sin(Math.PI * Math.min(frameCount - has_first_car - 350, 50)/100) * 50;
    push();
    translate(offset-50, 0);
    stroke(200);
    strokeWeight(5);
    line(40, height/3, 40, 2*height/3);
    const normal_dis = Math.min(DIS_NORMALIZE(average_dissatisfaction), 1);
    stroke(255 * (normal_dis+1)/2, 255 * (1-normal_dis)/2, 50);
    line(30, height/2 + normal_dis * height/6, 50, height/2 + normal_dis * height/6);
    pop();
  }

  translate(width/2, height/2);
  fill(...background_color);
  stroke(255);
  rect(0, 0, (GWIDTH+1)*ROADSIZE, (GHEIGHT+1)*ROADSIZE, ROADSIZE*CURVATURE);
  noStroke();
  fill(0);
  text("traffik", 0, -height/2+40);

  for(let x = -HALF_GWIDTH; x < HALF_GWIDTH+GX_EXTRA; x ++){
    for(let y = -HALF_GHEIGHT; y < HALF_GHEIGHT+GX_EXTRA; y ++){
      fill(...unavailable_color);
      if(mod(x, 2) == 1 && mod(y, 2) == 1){
        rect((x + GX_OFFSET) * ROADSIZE, (y + GY_OFFSET) * ROADSIZE, ROADSIZE, ROADSIZE, ROADSIZE*CURVATURE);
      }
      fill(100);
      const physposx = (x + GX_OFFSET) * ROADSIZE,
            physposy = (y + GY_OFFSET) * ROADSIZE;

      if(roadsgrid[xytoi(x, y)]){
        let neighbors = [x-1>=-HALF_GWIDTH && roadsgrid[xytoi(x-1,y)], y-1>=-HALF_GHEIGHT && roadsgrid[xytoi(x,y-1)], x+1<HALF_GWIDTH+GX_EXTRA && roadsgrid[xytoi(x+1,y)], y+1<HALF_GHEIGHT+GY_EXTRA && roadsgrid[xytoi(x,y+1)]];

        if(neighbors[0]&&neighbors[1]&&!neighbors[2]&&!neighbors[3]){
          arc(physposx-ROADSIZE/2, physposy-ROADSIZE/2, ROADSIZE*2, ROADSIZE*2, 0, HALF_PI)
        }
        else if(neighbors[1]&&neighbors[2]&&!neighbors[3]&&!neighbors[0]){
          arc(physposx+ROADSIZE/2, physposy-ROADSIZE/2, ROADSIZE*2, ROADSIZE*2, HALF_PI, PI)
        }
        else if(neighbors[2]&&neighbors[3]&&!neighbors[0]&&!neighbors[1]){
          arc(physposx+ROADSIZE/2, physposy+ROADSIZE/2, ROADSIZE*2, ROADSIZE*2, PI, PI+HALF_PI)
        }
        else if(neighbors[3]&&neighbors[0]&&!neighbors[1]&&!neighbors[2]){
          arc(physposx-ROADSIZE/2, physposy+ROADSIZE/2, ROADSIZE*2, ROADSIZE*2, PI+HALF_PI, 0)
        }
        else {
          rect(physposx, physposy, ROADSIZE, ROADSIZE, 
            (neighbors[0]||neighbors[1])?0:ROADSIZE/2,
            (neighbors[1]||neighbors[2])?0:ROADSIZE/2,
            (neighbors[2]||neighbors[3])?0:ROADSIZE/2,
            (neighbors[3]||neighbors[0])?0:ROADSIZE/2,
          );
        }

        if(neighbors[0]&&neighbors[1]&&!roadsgrid[xytoi(x-1,y-1)]){
          rect(physposx - ROADSIZE/2, physposy - ROADSIZE/2, ROADSIZE*CURVATURE, ROADSIZE*CURVATURE);
          fill(...unavailable_color);
          ellipse(physposx - ROADSIZE/2-ROADSIZE*CURVATURE/2, physposy - ROADSIZE/2-ROADSIZE*CURVATURE/2, ROADSIZE*CURVATURE, ROADSIZE*CURVATURE);
          fill(100);
        }
        if(neighbors[1]&&neighbors[2]&&!roadsgrid[xytoi(x+1,y-1)]){
          rect(physposx + ROADSIZE/2, physposy - ROADSIZE/2, ROADSIZE*CURVATURE, ROADSIZE*CURVATURE);
          fill(...unavailable_color);
          ellipse(physposx + ROADSIZE/2+ROADSIZE*CURVATURE/2, physposy - ROADSIZE/2-ROADSIZE*CURVATURE/2, ROADSIZE*CURVATURE, ROADSIZE*CURVATURE);
          fill(100);
        }
        if(neighbors[2]&&neighbors[3]&&!roadsgrid[xytoi(x+1,y+1)]){
          rect(physposx + ROADSIZE/2, physposy + ROADSIZE/2, ROADSIZE*CURVATURE, ROADSIZE*CURVATURE);
          fill(...unavailable_color);
          ellipse(physposx + ROADSIZE/2+ROADSIZE*CURVATURE/2, physposy + ROADSIZE/2+ROADSIZE*CURVATURE/2, ROADSIZE*CURVATURE, ROADSIZE*CURVATURE);
          fill(100);
        }
        if(neighbors[3]&&neighbors[0]&&!roadsgrid[xytoi(x-1,y+1)]){
          rect(physposx - ROADSIZE/2, physposy + ROADSIZE/2, ROADSIZE*CURVATURE, ROADSIZE*CURVATURE);
          fill(...unavailable_color);
          ellipse(physposx - ROADSIZE/2-ROADSIZE*CURVATURE/2, physposy + ROADSIZE/2+ROADSIZE*CURVATURE/2, ROADSIZE*CURVATURE, ROADSIZE*CURVATURE);
          fill(100);
        }
      }
    }
  }

  // ima leave this here totally out of context just for the reference
  //  c.type_of_motion = 0; // 0 = straight, 1 = diode (deep cut)

  for(let {x, y} of intersections_coordinates){
    let cars_here = cars.filter(c => c.x === x && c.y === y),
        cars_that_can_go = cars_here.filter(c => c.prc > 0 || cars.filter(c2 => c2.x === c.nx && c2.y === c.ny && (c2.nx !== c.x || c2.ny !== c.y)).length <= 1);
    if(cars_that_can_go.length && !cars_that_can_go.includes(intersectionsgrid[xytoi(x, y)])){
      intersectionsgrid[xytoi(x, y)] = cars_that_can_go.sort((a, b) => a.isct_waiting - b.isct_waiting)[0];
    }
  }

  // car animation
  for(let c of cars){
    let eligible_for_speed = false; // hmm, must not be a jazz musician

    let die_pop = 1;
    if(c.isdie !== false) die_pop = Math.pow(Math.sin(Math.PI / CAR_DIESCALE * (CAR_DIESCALE - c.isdie)), 2) + 1 - (CAR_DIESCALE - c.isdie) / CAR_DIESCALE;

    fill(...BUILDING_COLORS[c.t], c.isdie ? c.isdie * 255 / CAR_DIESCALE : 255);

    // u turn
    if(c.px == c.nx && c.py == c.ny){
      // 1. rotation point
      let rox = (c.px - c.x) / 2,
          roy = (c.py - c.y) / 2;
      // 2. angle
      let rangle = Math.atan2(roy, rox) - Math.PI/2 - c.prc * Math.PI;
      // 3. pos/vel
      c.dx = (c.x + rox) * ROADSIZE + Math.cos(rangle) * CAR_STREET_OFFSET * ROADSIZE;
      c.dy = (c.y + roy) * ROADSIZE + Math.sin(rangle) * CAR_STREET_OFFSET * ROADSIZE;
      c.dvx = Math.cos(rangle+Math.PI/2);
      c.dvy = Math.sin(rangle+Math.PI/2);
      // 4. draw
      push();
      translate(c.dx, c.dy);
      rotate(rangle);
      scale(die_pop);
      rect(0, 0, CARX, CARY);
      pop();
    }
    // straight line, yay
    else if(c.px == c.nx){
      let vert_vel = Math.sign(c.ny - c.py);
      c.dx = (c.x - CAR_STREET_OFFSET * vert_vel) * ROADSIZE;
      c.dy = (c.y + (c.prc - 0.5) * vert_vel) * ROADSIZE;
      c.dvx = 0;
      c.dvy = Math.sign(c.ny - c.py);
      push();
      translate(c.dx, c.dy);
      scale(die_pop);
      rect(0, 0, CARX, CARY);
      pop();
    } else if(c.py == c.ny){
      let horiz_vel = Math.sign(c.nx - c.px);
      c.dx = (c.x + (c.prc - 0.5) * horiz_vel) * ROADSIZE;
      c.dy = (c.y + CAR_STREET_OFFSET * horiz_vel) * ROADSIZE;
      c.dvx = Math.sign(c.nx - c.px);
      c.dvy = 0;
      push();
      translate(c.dx, c.dy);
      scale(die_pop);
      rect(0, 0, CARY, CARX);
      pop();
    } else {
      // the hard stuff
      // step 1. find the rotation corner
      let opx = c.px - c.x,
          opy = c.py - c.y,
          onx = c.nx - c.x,
          ony = c.ny - c.y;

      let ox = (opx + onx) / 2,
          oy = (opy + ony) / 2;

      let pxr = opx/2 - ox,
          pyr = opy/2 - oy,
          nxr = onx/2 - ox,
          nyr = ony/2 - oy;

      // step 2. rotation info
      let dir = -Math.sign(pxr*-nyr + pyr*nxr);
      let rot_start = Math.atan2(pyr, pxr);
      let rangle = rot_start + c.prc * Math.PI/2 * dir;

      if(dir > 0) eligible_for_speed = true; // faster around tight corner

      // step 3. pos/vel calculation
      c.dx = (c.x + ox) * ROADSIZE + Math.cos(rangle) * (0.5 - dir*CAR_STREET_OFFSET) * ROADSIZE;
      c.dy = (c.y + oy) * ROADSIZE + Math.sin(rangle) * (0.5 - dir*CAR_STREET_OFFSET) * ROADSIZE;
      c.dvx = Math.cos(rangle+dir*Math.PI/2);
      c.dvy = Math.sin(rangle+dir*Math.PI/2);

      // step 4. draw
      push();
      translate(c.dx, c.dy);
      rotate(rangle);
      scale(die_pop);
      rect(0, 0, CARX, CARY);
      pop();
    }

    // motion
    let waiting = false;
    if(c.px == c.nx && c.py == c.ny){ // something wrong? why stop midway
      if(c.prc > 0){}
      else {
        let cars_in_the_way = cars.filter(c2 => c2.x === c.nx && c2.y === c.ny && (c2.nx !== c.x || c2.ny !== c.y));
        if(cars_in_the_way.length > 1) waiting = true;
      }
    }
    else if(intersectionsgrid[xytoi(c.x, c.y)] !== false){
      if(c.isct_waiting === false) c.isct_waiting = frameCount;
      if(c !== intersectionsgrid[xytoi(c.x, c.y)]) waiting = true;
    }

    else {
      c.isct_waiting = false;
      for(let o of cars){
        if(o === c) { continue; }
        let distbetween = Math.sqrt(Math.pow(o.dx - c.dx, 2) + Math.pow(o.dy - c.dy, 2));
        if(distbetween > CARY * 1.3) continue;
        // opposing sides of the street?
        let vdot = o.dvx * c.dvx + o.dvy * c.dvy;
        if(vdot < 0) continue;
        
        let dx = o.dx - c.dx,
            dy = o.dy - c.dy;

        let vangle = Math.atan2(c.dvy, c.dvx),
            dangle = Math.atan2(dy, dx),
            adiff = -(vangle - dangle);

        if(adiff > Math.PI) adiff -= 2*Math.PI;
        if(adiff < -Math.PI) adiff += 2*Math.PI;

        if(adiff < -Math.PI/3 || adiff > Math.PI/3) continue; // give it wiggle room so it correctly follows on curves

        waiting = true;
        break;
      }
    }

    if(!waiting) c.prc += (1 + eligible_for_speed) / CARS_TIME_PER_ROADUNIT;
  }


  for(let b of buildings){
    const physposx = (b.x + GX_OFFSET) * ROADSIZE,
          physposy = (b.y + GY_OFFSET) * ROADSIZE;

    fill(50, 50);
    beginShape();
    let leftneighbor = !!buildings.find(b2 => b2.x === b.x-1 && b2.y === b.y);
    vertex(physposx + -ROADSIZE*1.1/2 + leftneighbor * ROADSIZE * 0.6, physposy + ROADSIZE*0.9/2);
    vertex(physposx + -ROADSIZE*1.1/2 + ROADSIZE*0.5 + leftneighbor * ROADSIZE * 0.1, physposy + ROADSIZE*0.9/2 + ROADSIZE*0.4);
    vertex(physposx + ROADSIZE*1.1/2 + ROADSIZE*0.5, physposy + ROADSIZE*0.9/2 + ROADSIZE*0.4);
    vertex(physposx + ROADSIZE*1.1/2 + ROADSIZE*0.5, physposy + -ROADSIZE*0.9/2 + ROADSIZE*0.4);
    let topneighbor = !!buildings.find(b2 => b2.x === b.x && b2.y === b.y-1);
    if(topneighbor){
      vertex(physposx + ROADSIZE*1.1/2 + ROADSIZE * 0.5/0.4*0.3, physposy + -ROADSIZE*0.9/2 + ROADSIZE*0.3);
      vertex(physposx + ROADSIZE*1.1/2, physposy + -ROADSIZE*0.9/2 + ROADSIZE*0.3);
    }
    else vertex(physposx + ROADSIZE*1.1/2, physposy + -ROADSIZE*0.9/2);
    endShape();
  }

  strokeWeight(4+0.5*Math.sin(frameCount/30));
  for(let b of buildings){
    const physposx = (b.x + GX_OFFSET) * ROADSIZE,
          physposy = (b.y + GY_OFFSET) * ROADSIZE;

    let destination = b.t >= TYPES_BUILDINGS;
    let bi = b.t % TYPES_BUILDINGS;
    fill(...BUILDING_COLORS[bi]);
    if(destination) stroke(255);
    rect(physposx, physposy, ROADSIZE*1.1, ROADSIZE*0.9, destination * 3);
    noStroke();
    if(!destination){
      fill(...BUILDING_COLORS[bi].map(x=>x*0.8));
      rect(physposx, physposy+ROADSIZE*0.9/4, ROADSIZE*1.1, ROADSIZE*0.9/2);
    }
  }

  if(frameCount < 350 && (!has_first_car || frameCount - has_first_car < 50)){
    textAlign(LEFT, CENTER);
    let time_to_come_back = has_first_car ? has_first_car : 300;
    let offset = -Math.sin(Math.PI * (frameCount < 50 ? frameCount : (frameCount > time_to_come_back ? frameCount - time_to_come_back + 50 : 50)) / 100) * 300;
    fill(0);
    textSize(18);
    text("\u24D8", width/2+offset-25, height/2 - 50);
    text("click & drag to connect houses to\nmatching destinations (white border)", width/2+offset, height/2 - 50);
    textSize(40);
    textAlign(CENTER, CENTER);
  }

  if(has_first_car && frameCount - has_first_car < 350){
    textAlign(LEFT, CENTER);
    let fc = frameCount - has_first_car;
    let offset = -Math.sin(Math.PI * (fc < 50 ? fc : (fc > 300 ? fc - 250 : 50)) / 100) * 245;
    fill(0);
    textSize(18);
    text("\u24D8", width/2+offset-25, height/2 - 50);
    text("great! keep connecting,\nand get everyone on the road", width/2+offset, height/2 - 50);
    textSize(40);
    textAlign(CENTER, CENTER);
  }

  if(has_first_car && frameCount - has_first_car > 350 && frameCount - has_first_car < 700){
    textAlign(LEFT, CENTER);
    let fc = frameCount - has_first_car - 350;
    let offset = -Math.sin(Math.PI * (fc < 50 ? fc : (fc > 300 ? fc - 250 : 50)) / 100) * 290;
    fill(0);
    textSize(18);
    text("\u24D8", width/2+offset-25, height/2 - 60);
    text("the meter on the left rates driver\nhappiness; reduce traffic & choose\nshort routes to keep it high!", width/2+offset, height/2 - 60);
    textSize(40);
    textAlign(CENTER, CENTER);
  }

  if(frame_lost === false && average_dissatisfaction >= MAX_DISSATISFACTION) frame_lost = frameCount;
  if(frame_lost !== false){
    background(0, Math.min(frameCount - frame_lost, 50));
    let offset = -Math.sin(Math.PI * Math.min(frameCount - frame_lost, 50)/100) * width/2;
    push();
    translate(width/2+offset, 0);
    fill(200);
    rect(0, 0, 300, 200, 25, 25);
    fill(0);
    textAlign(LEFT, CENTER);
    text("oh no.", -25, -30);
    textSize(15);
    text("too many traffic jams!\nyou'll do even better next time!", -25, 20);
    let mdist = Math.sqrt(Math.pow(width+offset-10 - mouseX, 2) + Math.pow(height/2+65 - mouseY, 2));
    textAlign(CENTER, CENTER);
    textSize(!mouseIsPressed && mdist < 20 ? 45 : 40);
    if(mouseIsPressed && mdist < 20){
      frame_lost = false;
      cars = [];
      average_dissatisfaction = 0;
      roadsgrid = new Array(GWIDTH * GHEIGHT).fill().map(_=>0);
      intersectionsgrid = new Array(GWIDTH * GHEIGHT).fill().map(_=>false);
      intersections_coordinates = [];
    }
    text("\u21BA", 0, 65);
    translate(-105, 0);
    fill(120, 131, 138);
    beginShape();
    vertex(16, -36);
    vertex(18, -16);
    vertex(46, -16);
    vertex(40, -34);
    endShape(CLOSE);
    fill(85, 182, 242);
    beginShape();
    vertex(-14, 0);
    vertex(0, -12);
    vertex(6, -32);
    vertex(16, -36);
    vertex(18, -16);
    vertex(30, -20);
    vertex(32, 8);
    vertex(-18, 20);
    endShape(CLOSE);
    fill(211, 219, 224);
    beginShape();
    vertex(30, -20);
    vertex(32, 8);
    vertex(60, 8);
    vertex(63, -18);
    endShape(CLOSE);
    fill(71, 137, 179);
    beginShape();
    vertex(-18, 20);
    vertex(32, 8);
    vertex(60, 8);
    vertex(10, 20);
    endShape(CLOSE);
    fill(100, 110, 110);
    ellipse(25, 27, 8, 20);
    ellipse(29, 27, 8, 20);
    rect(27, 27, 4, 20);
    fill(120, 131, 138);
    ellipse(0, 30, 8, 20);
    ellipse(4, 30, 8, 20);
    rect(2, 30, 4, 20);
    ellipse(20, 24, 8, 20);
    ellipse(24, 24, 8, 20);
    rect(22, 24, 4, 20);
    ellipse(45, 24, 8, 20);
    ellipse(49, 24, 8, 20);
    rect(47, 24, 4, 20);
    translate(-18, -30);
    rotate(-Math.PI/8);
    textSize(40);
    text("!", 0, 0);
    pop();
  }

  applyGrain();
}

function updatePaths(){
  let newcars = [];
  for(let c of cars){
    // path reconstruction: car will go to new space
    let new_path = searchAstar(c.nx, c.ny, c.dest.x, c.dest.y);
    if(roadsgrid[xytoi(c.x, c.y)] && new_path && new_path.length > 0) {
      c.path = [{x: c.x, y: c.y}, ...new_path];
    } else if(c.isdie === false) c.isdie = CAR_DIESCALE;

    newcars.push(c);
  }
  cars = newcars;

  for(let x = -HALF_GWIDTH; x < HALF_GWIDTH+GX_EXTRA; x ++){
    for(let y = -HALF_GHEIGHT; y < HALF_GHEIGHT+GX_EXTRA; y ++){
      if(!roadsgrid[xytoi(x, y)]){
        intersectionsgrid[xytoi(x, y)] = false;
        intersections_coordinates = intersections_coordinates.filter(f => f.x !== x || f.y !== y); // f? why am I using f?
        continue;
      }

      let ncount = 0;
      for(let o of noffsets){
        let neighbor = {x: x + o.x, y: y + o.y};
        if(neighbor.x < -HALF_GWIDTH || neighbor.y < -HALF_GHEIGHT || neighbor.x >= HALF_GWIDTH+GX_EXTRA || neighbor.y >= HALF_GHEIGHT+GY_EXTRA) continue;
        if(!roadsgrid[xytoi(neighbor.x, neighbor.y)]) continue;
        ncount ++;
      }

      if(ncount > 2){
        if(intersectionsgrid[xytoi(x, y)] === false) { 
          intersectionsgrid[xytoi(x, y)] = undefined;
          intersections_coordinates.push({x, y});
        }
      } else {
        intersectionsgrid[xytoi(x, y)] = false;
        intersections_coordinates = intersections_coordinates.filter(f => f.x !== x || f.y !== y);
      }
    }
  }
}

function mod(n, m){
  return ((n % m) + m) % m;
}

let isplacing = false;
function mousePressed(){
  if(frame_lost !== false) return;
  let gridmouseX = Math.floor((mouseX-width/2)/ROADSIZE-GX_OFFSET+0.5),
      gridmouseY = Math.floor((mouseY-height/2)/ROADSIZE-GY_OFFSET+0.5);

  if(gridmouseX < -HALF_GWIDTH || gridmouseX >= HALF_GWIDTH+GX_EXTRA || gridmouseY < -HALF_GHEIGHT || gridmouseY >= HALF_GHEIGHT+GY_EXTRA) { isplacing = true; return; }

  if((mod(gridmouseX, 2) == 1 && mod(gridmouseY, 2) == 1)) return;

  roadsgrid[xytoi(gridmouseX, gridmouseY)] = !roadsgrid[xytoi(gridmouseX, gridmouseY)];
  isplacing = roadsgrid[xytoi(gridmouseX, gridmouseY)];
  updatePaths();
}

function mouseDragged(){
  if(frame_lost !== false) return;
  let gridmouseX = Math.floor((mouseX-width/2+1)/ROADSIZE-GX_OFFSET+0.5),
      gridmouseY = Math.floor((mouseY-height/2)/ROADSIZE-GY_OFFSET+0.5);

  if(gridmouseX < -HALF_GWIDTH || gridmouseX >= HALF_GWIDTH+GX_EXTRA || gridmouseY < -HALF_GHEIGHT || gridmouseY >= HALF_GHEIGHT+GY_EXTRA) return;
  
  if((mod(gridmouseX, 2) == 1 && mod(gridmouseY, 2) == 1)) return;

  roadsgrid[xytoi(gridmouseX, gridmouseY)] = isplacing;
  updatePaths();
}

function windowResized(){
  resizeCanvas(windowWidth, windowHeight);
  grainbuffer.remove();
  grainbuffer = createGraphics(windowWidth, windowHeight, WEBGL);
  grainbuffer.noStroke();
  grainbuffer.rectMode(CENTER);
  grainshader = grainbuffer.createShader(grainvert, grainfrag);
  calculateRoadScale();
}