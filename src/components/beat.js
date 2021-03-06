import {SWORD_OFFSET} from './beat-generator';
const COLORS = require('../constants/colors.js');

const auxObj3D = new THREE.Object3D();
const bbox = new THREE.Box3();
const otherBbox = new THREE.Box3();
const collisionZThreshold = -1.65;

const ANGLE_MAX_SUPER = THREE.Math.degToRad(10);
const ANGLE_THRESHOLD = THREE.Math.degToRad(40);
const CUT_THICKNESS = 0.02;
const WARMUP_TIME = 2000;
const WARMUP_ROTATION_CHANGE = 2 * Math.PI;

const elasticEasing = getElasticEasing(1.33, 0.5);

const DESTROYED_SPEED = 1.0;
const ONCE = {once: true};
const DESTROY_TIME = 1000;

// Play sound and explode at reach to test sync.
const SYNC_TEST = !!AFRAME.utils.getUrlParameter('synctest');
const syncTestObject3D = new THREE.Object3D();
const syncTestVector3 = new THREE.Vector3();

const MINE = 'mine';
const DOT = 'dot';

AFRAME.registerComponent('beat-system', {
  schema: {
    gameMode: {default: 'classic'},
    hasVR: {default: false},
    isLoading: {default: false}
  },

  // Will be overridden.
  verticalPositions: {
    bottom: 0.95,
    middle: 1.35,
    top: 1.75
  },

  update: function (oldData) {
    if (oldData.isLoading && !this.data.isLoading) {
      this.updateVerticalPositions();
    }
  },

  updateVerticalPositions: function () {
    const MIN_BOTTOM_HEIGHT = 0.4;
    const BOTTOM_HEIGHT = 0.95;
    const MARGIN = 0.4;

    const offset = this.el.sceneEl.camera.el.object3D.position.y - 1.6;
    this.verticalPositions.bottom = Math.max(MIN_BOTTOM_HEIGHT,
                                             BOTTOM_HEIGHT + offset);
    this.verticalPositions.middle = Math.max(MIN_BOTTOM_HEIGHT + MARGIN,
                                             BOTTOM_HEIGHT + MARGIN + offset);
    this.verticalPositions.top = Math.max(MIN_BOTTOM_HEIGHT + MARGIN * 2,
                                          BOTTOM_HEIGHT + (MARGIN * 2) + offset);
  }
});

/**
 * Bears, beats, Battlestar Galactica.
 * Create beat from pool, collision detection, movement, scoring.
 */
AFRAME.registerComponent('beat', {
  schema: {
    color: {default: 'red', oneOf: ['red', 'blue']},
    debug: {default: false},
    size: {default: 0.35},
    type: {default: 'arrow', oneOf: ['arrow', DOT, MINE]}
  },

  materialColor: {
    blue: COLORS.BLUE,
    red: COLORS.RED
  },

  cutColor: {
    blue: '#fff',
    red: '#fff'
  },

  models: {
    arrowblue: 'blueBeatObjTemplate',
    arrowred: 'redBeatObjTemplate',
    dotblue: 'dotBlueObjTemplate',
    dotred: 'dotRedObjTemplate',
    mine: 'mineObjTemplate'
  },

  orientations: [180, 0, 270, 90, 225, 135, 315, 45, 0],

  rotations: {
    right: 0,
    upright: 45,
    up: 90,
    upleft: 135,
    left: 180,
    downleft: 225,
    down: 270,
    downright: 315
  },

  horizontalPositions: {
    left: -0.5,
    middleleft: -0.18,
    middleright: 0.18,
    right: 0.5
  },

  cutDirectionVectors: {
    up: new THREE.Vector3(0, 1, 0),
    down: new THREE.Vector3(0, -1, 0),
    left: new THREE.Vector3(-1, 0, 0),
    right: new THREE.Vector3(1, 0, 0),
    upleft: new THREE.Vector3(-1, 1, 0).normalize(),
    upright: new THREE.Vector3(1, 1, 0).normalize(),
    downleft: new THREE.Vector3(-1, -1, 0).normalize(),
    downright: new THREE.Vector3(1, -1, 0).normalize()
  },

  init: function () {
    this.beatBbox = new THREE.Box3();
    this.beatSystem = this.el.sceneEl.components['beat-system'];
    this.bladeEls = this.el.sceneEl.querySelectorAll('a-entity[blade]');
    this.broken = null;
    this.brokenPoolName = undefined;
    this.destroyed = false;
    this.gravityVelocity = 0;
    this.hitEventDetail = {};
    this.poolName = undefined;
    this.punchEls = this.el.sceneEl.querySelectorAll('a-entity.punch');
    this.returnToPoolTimer = DESTROY_TIME;
    this.rotationAxis = new THREE.Vector3();
    this.shadow = null;
    this.superCutIdx = 0;
    this.startPositionZ = undefined;
    this.warmupTime = 0;
    this.weaponColors = {right: 'blue', left: 'red'};

    this.curveEl = document.getElementById('curve');
    this.curveFollowRig = document.getElementById('curveFollowRig');
    this.mineParticles = document.getElementById('mineParticles');
    this.rigContainer = document.getElementById('rigContainer');
    this.superCuts = document.querySelectorAll('.superCutFx');

    this.verticalPositions = this.beatSystem.verticalPositions;

    this.explodeEventDetail = {
      beatDirection: '',
      color: this.data.color,
      direction: new THREE.Vector3(),
      gameMode: '',
      goodCut: false,
      position: new THREE.Vector3(),
      rotation: new THREE.Euler()
    };

    this.calculateScoreBlade = this.calculateScoreBlade.bind(this);

    this.blockEl = document.createElement('a-entity');
    this.blockEl.setAttribute('mixin', 'beatBlock');
    this.el.appendChild(this.blockEl);
    this.initMesh();

    if (this.data.type === MINE) {
      this.poolName = 'pool__beat-mine';
    } else {
      this.poolName = `pool__beat-${this.data.type}-${this.data.color}`;
    }
  },

  tock: function (time, timeDelta) {
    const el = this.el;
    const data = this.data;
    const position = el.object3D.position;
    const rotation = el.object3D.rotation;

    if (this.beatSystem.data.gameMode === 'ride') { return; }

    if (this.destroyed) {
      this.tockDestroyed(timeDelta);
      return;
    }

    const supercurve = this.curveEl.components.supercurve;
    const curve = supercurve.curve;
    const progress = supercurve.curveProgressToSongProgress(
      this.curveFollowRig.components['supercurve-follow'].curveProgress);

    // Only check collisions when close.
    const beatHit = this.songPosition - (SWORD_OFFSET / curve.getLength());
    if (progress > beatHit) {
      this.checkCollisions();
      if (this.destroyed) { return; }

      // If ?synctest=true, auto-explode beat and play sound to easily test sync.
      if ((SYNC_TEST || !this.beatSystem.data.hasVR) && data.type !== MINE) {
        this.destroyBeat(this.bladeEls[0], Math.random() < 0.7);
        el.parentNode.components['beat-hit-sound'].playSound(el, this.cutDirection);
        const hitEventDetail = this.hitEventDetail;
        hitEventDetail.score = 100;
        el.emit('beathit', hitEventDetail, true);
        return;
      }
    }

    // Warmup animation.
    if (this.warmupTime < WARMUP_TIME) {
      const progress = elasticEasing(this.warmupTime / WARMUP_TIME);
      el.object3D.rotation.y = this.rotationStart + (progress * this.rotationChange);
      el.object3D.position.y = this.positionStart + (progress * this.positionChange);
      this.warmupTime += timeDelta;
    }

    // Check if past the camera to return to pool.
    if (position.z > this.curveFollowRig.object3D.position.z) {
      this.returnToPool();
      this.missHit();
    }
  },

  /**
   * Called when summoned by beat-generator.
   * Called after updatePosition.
   */
  onGenerate: function (songPosition, horizontalPosition, verticalPosition, cutDirection) {
    const data = this.data;
    const el = this.el;

    this.cutDirection = cutDirection || 'down';
    this.songPosition = songPosition;

    if (!this.blockEl) {
      console.warn('Unable to generate beat. blockEl was undefined.');
      return;
    }

    this.blockEl.object3D.visible = true;
    this.destroyed = false;
    el.object3D.visible = true;

    this.warmupTime = 0;

    // Set position.
    const supercurve = this.curveEl.components.supercurve;
    supercurve.getPointAt(songPosition, el.object3D.position);
    supercurve.alignToCurve(songPosition, el.object3D);
    el.object3D.position.x += this.horizontalPositions[horizontalPosition],
    el.object3D.rotation.z = THREE.Math.degToRad(this.rotations[cutDirection]);

    // Shadow.
    // this.shadow = this.el.sceneEl.components['pool__beat-shadow'].requestEntity();
    if (this.shadow) {
      this.shadow.object3D.visible = true;
      this.shadow.object3D.position.copy(el.object3D.position);
      this.shadow.object3D.position.y += 0.05;
    }

    // Set up rotation warmup.
    this.rotationStart = el.object3D.rotation.y;
    this.rotationChange = WARMUP_ROTATION_CHANGE;
    if (Math.random > 0.5) { this.rotationChange *= -1; }

    // Set up position warmup.
    const offset = 0.5;
    el.object3D.position.y -= offset;
    this.positionStart = el.object3D.position.y;
    this.positionChange = this.verticalPositions[verticalPosition] + offset;
  },

  /**
   * Set geometry and maybe material.
   */
  initMesh: function () {
    const blockEl = this.blockEl;
    const el = this.el;
    const type = this.data.type;

    setObjModelFromTemplate(
      blockEl,
      this.models[type !== 'mine' ? `${type}${this.data.color}` : type]);

    // Model is 0.29 size. We make it 1.0 so we can easily scale based on 1m size.
    blockEl.object3D.scale.set(1, 1, 1);
    blockEl.object3D.scale.multiplyScalar(4).multiplyScalar(this.data.size);

    blockEl.setAttribute('materials', 'name', 'beat');
  },

  wrongHit: function (hand) {
    this.el.sceneEl.emit('beatwrong', null, true);
    this.destroyed = true;
  },

  missHit: function (hand) {
    const data = this.data;
    if (data.type === MINE) { return; }
    this.el.sceneEl.emit('beatmiss', null, true);
    if (AFRAME.utils.getUrlParameter('synctest')) {
      console.log(this.el.sceneEl.components.song.getCurrentTime());
    }
  },

  destroyBeat: (function () {
    const cutDirection = new THREE.Vector3();
    const cutPlane = new THREE.Plane();
    const point1 = new THREE.Vector3();
    const point2 = new THREE.Vector3();
    const point3 = new THREE.Vector3();

    return function (bladeEl, goodCut) {
      const data = this.data;
      const explodeEventDetail = this.explodeEventDetail;
      const rig = this.rigContainer.object3D;

      if (data.debug) { this.debugDestroyBeat(); }

      this.blockEl.object3D.visible = false;

      this.destroyed = true;
      this.gravityVelocity = 0.1;
      this.returnToPoolTimer = DESTROY_TIME;

      // Blade cut direction effect.
      if (this.beatSystem.data.gameMode === 'classic') {
        const trailPoints = bladeEl.components.trail.bladeTrajectory;
        point1.copy(trailPoints[0].top);
        point2.copy(trailPoints[0].center);
        point3.copy(trailPoints[trailPoints.length - 1].top);

        cutDirection.copy(point1).sub(point3);
        cutPlane.setFromCoplanarPoints(point1, point2, point3);

        auxObj3D.up.copy(cutPlane.normal).multiplyScalar(-1);
        auxObj3D.lookAt(cutDirection);
        explodeEventDetail.rotation = auxObj3D.rotation;
        explodeEventDetail.direction.copy(cutDirection);
      }

      explodeEventDetail.beatDirection = this.cutDirection;
      explodeEventDetail.color = this.data.color;
      explodeEventDetail.goodCut = goodCut;
      explodeEventDetail.gameMode = this.beatSystem.data.gameMode;
      explodeEventDetail.position.copy(this.el.object3D.position);
      rig.worldToLocal(explodeEventDetail.position);

      let brokenPoolName;
      if (this.data.type === MINE) {
        brokenPoolName = 'pool__beat-broken-mine';
      } else {
        const mode = this.beatSystem.data.gameMode === 'classic' ? 'beat' : 'punch';
        brokenPoolName = `pool__${mode}-broken-${this.data.color}`;
        if (this.data.type === DOT) {
          brokenPoolName += '-dot';
        }
      }

      this.broken = this.el.sceneEl.components[brokenPoolName].requestEntity();
      if (this.broken) {
        this.broken.emit('explode', this.explodeEventDetail, false);
      }
      if (this.shadow) {
        this.el.sceneEl.components['pool__beat-shadow'].returnEntity(this.shadow);
        this.shadow.object3D.visible = false;
        this.shadow = null;
      }

      if (this.beatSystem.data.gameMode === 'classic' && goodCut) {
        bladeEl.components.trail.pulse();
      }
    };
  })(),

  /**
   * Check if need to return to pool.
   */
  returnToPool: function () {
    this.el.object3D.position.set(0, 0, -9999);
    this.el.object3D.visible = false;
    if (this.el.isPlaying) {
      this.el.sceneEl.components[this.poolName].returnEntity(this.el);
    }
    if (this.shadow) {
      this.el.sceneEl.components['pool__beat-shadow'].returnEntity(this.shadow);
      this.shadow.object3D.visible = false;
      this.shadow = null;
    }
  },

  checkCollisions: function () {
    const data = this.data;
    const weaponColors = this.weaponColors;

    if (!this.blockEl.getObject3D('mesh')) { return; }

    const beatBbox = this.beatBbox.setFromObject(this.blockEl.getObject3D('mesh'));
    beatBbox.expandByScalar(-0.1);

    const weaponEls = this.beatSystem.data.gameMode === 'classic'? this.bladeEls : this.punchEls;
    for (let i = 0; i < weaponEls.length; i++) {
      const weaponEl = weaponEls[i];
      let weaponBbox;

      if (this.beatSystem.data.gameMode === 'punch') {
        bbox.setFromObject(weaponEl.getObject3D('mesh')).expandByScalar(0.1);
        weaponBbox = bbox;
      } else {
        const blade = weaponEl.components.blade;
        weaponBbox = blade.boundingBox;
      }

      if (!weaponBbox) { continue; }
      if (!weaponBbox.intersectsBox(beatBbox)) { continue; }

      // Notify for haptics.
      const hand = weaponEl.closest('[controller]').getAttribute('controller').hand;
      this.el.emit(`beatcollide${hand}`, null, true);

      // Sound.
      this.el.parentNode.components['beat-hit-sound'].playSound(
        this.el, this.cutDirection);

      if (this.data.type === MINE) {
        this.el.emit('minehit', null, true);
        this.destroyBeat(weaponEl);
        break;
      }

      // Wrong color hit.
      let goodCut = true;
      if (this.data.color !== weaponColors[hand]) {
        const otherWeapon = i === 0 ? weaponEls[1] : weaponEls[0];
        if (!this.checkOtherWeaponCollision(otherWeapon, beatBbox)) {
          this.wrongHit(hand);
          goodCut = false;
        }
      }

      // Do blade-related checks.
      if (this.beatSystem.data.gameMode === 'classic' && goodCut) {
        goodCut = this.checkCollisionBlade(weaponEl);
      }

      this.destroyBeat(weaponEl, goodCut);

      // Do punch-related checks.
      if (this.beatSystem.data.gameMode === 'punch') {
        this.calculateScorePunch(weaponEl.parentNode);
      }
    }
  },

  /**
   * Check false positive for wrong color hits on nearby beats on double hits.
   */
  checkOtherWeaponCollision: (function () {
    const otherBbox = new THREE.Box3();

    return function (otherWeapon, beatBbox) {
      if (!otherWeapon) { return false; }

      // Check that other blade isn't also colliding.
      if (this.beatSystem.data.gameMode === 'classic') {
        const otherBlade = otherWeapon.components.blade;
        return otherBlade.boundingBox.intersectsBox(beatBbox);
      }

      // Check that other hand isn't also colliding.
      otherBbox.setFromObject(otherWeapon.getObject3D('mesh')).expandByScalar(0.1);
      return otherBbox.intersectsBox(beatBbox);
    }
  })(),

  /**
   * Angle-related stuff.
   */
  checkCollisionBlade: function (bladeEl) {
    const data = this.data;
    const cutDirection = this.cutDirection;
    const blade = bladeEl.components.blade;
    const hand = bladeEl.getAttribute('blade').hand;

    // Dot.
    if (data.type === 'arrow') {
      // Wrong angle.
      const strokeBeatAngle = blade.strokeDirectionVector.angleTo(
        this.cutDirectionVectors[this.cutDirection]);
      if (strokeBeatAngle > ANGLE_THRESHOLD) {
        this.wrongHit(hand);
        return false;
      }
      this.calculateScoreBlade(bladeEl, strokeBeatAngle);
    } else {
      this.calculateScoreBlade(bladeEl, 0);
    }

    return true;
  },

  /**
   * Emit score and show score effects.
   * Called by multiple modes (blade, punch).
   */
  score: function (score) {
    const el = this.el;

    const hitEventDetail = this.hitEventDetail;
    hitEventDetail.score = score;
    el.emit('beathit', hitEventDetail, true);
    el.sceneEl.emit('textglowbold', null, false);

    // Super FX.
    if (score > 80) {
      this.superCuts[this.superCutIdx].components.supercutfx.createSuperCut(
        el.object3D, this.data.color);
      this.superCutIdx = (this.superCutIdx + 1) % this.superCuts.length;
    }
  },

  /**
   * Blade scoring.
   */
  calculateScoreBlade: function (bladeEl, angle) {
    // 80% score on speed.
    let SUPER_SCORE_SPEED = 10;
    if (this.cutDirection === 'down') {
      SUPER_SCORE_SPEED = 22;
    }
    const speed = bladeEl.closest('[blade]').components.blade.strokeSpeed;
    let score = (Math.min((speed / SUPER_SCORE_SPEED) * 100, 100) / 100) * 80;

    // 20% score on direction.
    if (angle < ANGLE_MAX_SUPER) {
      score += 20;
    } else {
      score += ((ANGLE_THRESHOLD - angle) / ANGLE_THRESHOLD) * 20;
    }

    this.score(Math.round(score));
  },

  /**
   * A possible To Do would be to score based on punch velocity and direction.
   * More points scored if punching straight down the curve.
   */
  calculateScorePunch: function (punchEl) {
    // Get 60% of the score just by hitting the beat.
    let score = 60;
    const SUPER_SCORE_SPEED = 6;
    const speed = punchEl.closest('[hand-velocity]').components['hand-velocity'].speed;
    score += Math.min((speed / SUPER_SCORE_SPEED), 1) * 40;
    this.score(score);
  },

  /**
   * Destroyed animation.
   */
  tockDestroyed: function (timeDelta) {
    this.returnToPoolTimer -= timeDelta;
    if (this.returnToPoolTimer <= 0) { this.returnToPool(); }
  }
});

/**
 * Load OBJ from already parsed and loaded OBJ template.
 */
const geometries = {};
function setObjModelFromTemplate (el, templateId) {
  // Load into cache.
  if (!geometries[templateId]) {
    const templateEl = document.getElementById(templateId);
    if (templateEl.getObject3D('mesh')) {
      // Set cache.
      geometries[templateId] = templateEl.getObject3D('mesh').children[0].geometry;
    } else {
      // Wait.
      templateEl.addEventListener('object3dset', evt => {
        if (evt.detail.type !== 'mesh') { return; }
        setObjModelFromTemplate(el, templateId);
      }, ONCE);
      return;
    }
  }

  // Set geometry.
  if (geometries[templateId]) {
    if (!el.getObject3D('mesh')) { el.setObject3D('mesh', new THREE.Mesh()); }
    el.getObject3D('mesh').geometry = geometries[templateId];
  }
}

/**
 * Get velocity given current velocity using gravity acceleration.
 */
function getGravityVelocity (velocity, timeDelta) {
  const GRAVITY = -9.8;
  return velocity + (GRAVITY * (timeDelta / 1000));
}

function getElasticEasing (a, p) {
  return t => 1 - elastic(a, p)(1 - t);
}

function elastic (amplitude, period) {
  function minMax (val, min, max) {
    return Math.min(Math.max(val, min), max);
  }

  const a = minMax(amplitude || 1, 1, 10);
  const p = minMax(period || 0.5, .1, 2);
  return t => {
    return (t === 0 || t === 1)
      ? t
      : -a * Math.pow(2, 10 * (t - 1)) *
       Math.sin((((t - 1) - (p / (Math.PI * 2) *
       Math.asin(1 / a))) * (Math.PI * 2)) / p);
  }
}
