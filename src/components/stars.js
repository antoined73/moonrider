const COLORS = require('../constants/colors');

AFRAME.registerComponent('stars', {
  schema: {
    count: {default: 1000},
    radius: {default: 1000},
    color: {type: 'color', default: COLORS.BLUE}
  },

  init: function () {
    const rand = () => (Math.random() - 0.5) * this.data.radius * 2.0;
    var geometry = new THREE.BufferGeometry();
    this.material = this.el.sceneEl.systems.materials.stars;
    var positions = [];
    for (var i = 0; i < this.data.count; i++) {
      positions.push(rand(), rand(), rand() * 2);
    }
    geometry.addAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.computeBoundingSphere();
    var points = new THREE.Points(geometry, this.material);
    this.el.setObject3D('stars', points);
  },

  update: function () {
    this.material.color.setStyle(this.data.color);
  }

})
