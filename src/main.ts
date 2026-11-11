import { MapReader } from "./mapReader.js";
const $ = function (id: string) {
    return document.getElementById(id)!
}
let map = new MapReader('./maps/吞食天地.png')
$('test').appendChild(map.element)