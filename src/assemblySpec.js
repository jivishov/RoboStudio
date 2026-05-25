export const SOURCE_STL_COUNT = 10;

export const SOURCE_REFERENCE_URL =
  "https://cults3d.com/en/3d-model/gadget/diy-arduino-robot-arm-with-smartphone-control";

const deg = (value) => (value * Math.PI) / 180;

const lowerArmAngle = deg(-14);
const upperArmAngle = deg(5);
const wristAngle = deg(5);
const arm02CupContactOffsetZ = 23.699521;
const elbowContactPlaneZ = 10.5;

const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const armVector = (length, angle) => [-Math.sin(angle) * length, Math.cos(angle) * length, 0];

const shoulderJoint = [0, 122, 0];
const arm01ElbowCup = add(shoulderJoint, armVector(120, lowerArmAngle));
const arm02ElbowCup = [
  arm01ElbowCup[0],
  arm01ElbowCup[1],
  arm02CupContactOffsetZ
];
const elbowAxlePoint = [
  arm01ElbowCup[0],
  arm01ElbowCup[1],
  arm02CupContactOffsetZ / 2
];
const wristJoint = add(arm02ElbowCup, armVector(82.5, upperArmAngle));
const gripperMountJoint = add(wristJoint, armVector(27.5, wristAngle));
const gearLeftJoint = [gripperMountJoint[0] - 14, gripperMountJoint[1] + 53, gripperMountJoint[2]];
const gearRightJoint = [gripperMountJoint[0] + 14, gripperMountJoint[1] + 53, gripperMountJoint[2]];

export const jointAnchors = {
  turntable: [0, 62, 0],
  shoulder: shoulderJoint,
  elbow: elbowAxlePoint,
  wrist: wristJoint,
  gripper_mount: gripperMountJoint,
  left_gear: gearLeftJoint,
  right_gear: gearRightJoint
};

export const stlInstances = [
  {
    id: "base",
    label: "Base",
    file: "Base.STL",
    color: "#f4f5f8",
    position: [0, 28, 0],
    rotation: [0, deg(45), 0]
  },
  {
    id: "waist",
    label: "Waist",
    file: "Waist.STL",
    color: "#2157d9",
    position: [0, 88.388, 0],
    rotation: [0, deg(45), 0]
  },
  {
    id: "lower_arm",
    label: "Arm 01 lower link",
    file: "Arm 01.STL",
    color: "#1556d4",
    rotation: [0, 0, lowerArmAngle],
    anchorOriginal: [28.5, 25.7, 10.5],
    targetWorld: shoulderJoint,
    jointNotes: "Lower circular pivot aligned to the shoulder/waist axle."
  },
  {
    id: "upper_arm",
    label: "Arm 02 upper link",
    file: "Arm 02 v3.STL",
    color: "#f7f8fb",
    rotation: [0, 0, upperArmAngle],
    scale: [1, 1, -1],
    anchorOriginal: [19.3, 25, 13.87818795],
    targetWorld: arm02ElbowCup,
    jointNotes:
      "Arm 02 is flipped through its length axis. Its lower cup shares Arm 01's upper-cup centerline, with mesh-derived smooth cup faces touching at the elbow contact plane."
  },
  {
    id: "wrist_yoke",
    label: "Arm 03 wrist yoke",
    file: "Arm 03.STL",
    color: "#e8ebf2",
    rotation: [0, 0, wristAngle],
    anchorOriginal: [16.5, 9, 14],
    targetWorld: wristJoint,
    jointNotes: "Lower screw hole aligned to the upper arm wrist mount."
  },
  {
    id: "gripper_base",
    label: "Gripper base",
    file: "Gripper base.STL",
    color: "#d7dce7",
    rotation: [deg(-90), 0, wristAngle],
    anchorOriginal: [22.2, 14, 18],
    targetWorld: gripperMountJoint,
    jointNotes: "Lower gripper-base body mounted to the Arm 03 upper screw hole."
  },
  {
    id: "gear_left",
    label: "Gear 1",
    file: "gear1.STL",
    color: "#b9bfcc",
    rotation: [deg(90), 0, 0],
    anchorOriginal: [14.55, 2, 14.52],
    targetWorld: gearLeftJoint,
    jointNotes: "Main gear bore aligned to the left gripper-base gear pivot."
  },
  {
    id: "gear_right",
    label: "Gear 2",
    file: "gear2.STL",
    color: "#aeb5c3",
    rotation: [deg(90), 0, 0],
    anchorOriginal: [34.5, 2, 14.52],
    targetWorld: gearRightJoint,
    jointNotes: "Main gear bore aligned to the right gripper-base gear pivot."
  },
  {
    id: "gripper_finger_left",
    label: "Gripper finger left",
    file: "Gripper 1.STL",
    color: "#d2d6df",
    rotation: [deg(90), 0, deg(-18)],
    anchorOriginal: [4.25, 4.25, 38.2],
    targetWorld: [gearLeftJoint[0] - 8, gearLeftJoint[1] + 4, gearLeftJoint[2]],
    jointNotes: "Finger lower pivot aligned beside the left gear."
  },
  {
    id: "gripper_finger_right",
    label: "Gripper finger right",
    file: "Gripper 1.STL",
    color: "#d2d6df",
    rotation: [deg(90), 0, deg(18)],
    anchorOriginal: [4.25, 4.25, 38.2],
    targetWorld: [gearRightJoint[0] + 8, gearRightJoint[1] + 4, gearRightJoint[2]],
    scale: [-1, 1, 1],
    inferred: true,
    inferredReason: "Mirrored from Gripper 1.STL because the opposite finger STL is absent locally.",
    jointNotes: "Mirrored finger pivot aligned beside the right gear."
  },
  {
    id: "grip_link_left_lower",
    label: "Grip link left lower",
    file: "grip link 1.STL",
    color: "#c6cbd5",
    rotation: [deg(90), 0, deg(-20)],
    anchorOriginal: [4.31, 2, 4],
    targetWorld: [gearLeftJoint[0] - 5, gearLeftJoint[1] + 15, gearLeftJoint[2] + 3],
    jointNotes: "Link endpoint placed on the left gear linkage pin."
  },
  {
    id: "grip_link_left_upper",
    label: "Grip link left upper",
    file: "grip link 1.STL",
    color: "#c6cbd5",
    rotation: [deg(90), 0, deg(-42)],
    anchorOriginal: [4.31, 2, 4],
    targetWorld: [gearLeftJoint[0] - 1, gearLeftJoint[1] + 31, gearLeftJoint[2] + 3],
    inferred: true,
    inferredReason: "Duplicated linkage from the available grip link STL.",
    jointNotes: "Duplicated upper linkage placed between gear and finger pivots."
  },
  {
    id: "grip_link_right_lower",
    label: "Grip link right lower",
    file: "grip link 1.STL",
    color: "#c6cbd5",
    rotation: [deg(90), 0, deg(20)],
    anchorOriginal: [4.31, 2, 4],
    targetWorld: [gearRightJoint[0] + 5, gearRightJoint[1] + 15, gearRightJoint[2] + 3],
    scale: [-1, 1, 1],
    inferred: true,
    inferredReason: "Mirrored linkage from the available grip link STL.",
    jointNotes: "Mirrored linkage endpoint placed on the right gear linkage pin."
  },
  {
    id: "grip_link_right_upper",
    label: "Grip link right upper",
    file: "grip link 1.STL",
    color: "#c6cbd5",
    rotation: [deg(90), 0, deg(42)],
    anchorOriginal: [4.31, 2, 4],
    targetWorld: [gearRightJoint[0] + 1, gearRightJoint[1] + 31, gearRightJoint[2] + 3],
    scale: [-1, 1, 1],
    inferred: true,
    inferredReason: "Mirrored linkage from the available grip link STL.",
    jointNotes: "Mirrored upper linkage placed between gear and finger pivots."
  }
];

export const inferredSupports = [
  {
    id: "inferred_support_front",
    label: "Inferred support foot front",
    color: "#565d6a",
    type: "box",
    size: [92, 7, 16],
    position: [0, 4, 72],
    rotation: [0, 0, 0]
  },
  {
    id: "inferred_support_back",
    label: "Inferred support foot back",
    color: "#565d6a",
    type: "box",
    size: [92, 7, 16],
    position: [0, 4, -72],
    rotation: [0, 0, 0]
  },
  {
    id: "inferred_support_left",
    label: "Inferred support foot left",
    color: "#565d6a",
    type: "box",
    size: [16, 7, 92],
    position: [-72, 4, 0],
    rotation: [0, 0, 0]
  },
  {
    id: "inferred_support_right",
    label: "Inferred support foot right",
    color: "#565d6a",
    type: "box",
    size: [16, 7, 92],
    position: [72, 4, 0],
    rotation: [0, 0, 0]
  }
];

export const inferredJointConnectors = [
  {
    id: "inferred_turntable_pin",
    label: "Inferred base turntable pin",
    color: "#303642",
    type: "cylinder",
    radius: 5,
    length: 72,
    position: [0, 62, 0],
    rotation: [0, 0, 0],
    reason: "Vertical axle connecting Base.STL and Waist.STL."
  },
  {
    id: "inferred_shoulder_axle",
    label: "Inferred shoulder axle",
    color: "#303642",
    type: "cylinder",
    radius: 5.5,
    length: 52,
    position: shoulderJoint,
    rotation: [deg(90), 0, 0],
    reason: "Axle through the waist shoulder and Arm 01 lower pivot."
  },
  {
    id: "inferred_elbow_axle",
    label: "Inferred elbow axle",
    color: "#303642",
    type: "cylinder",
    radius: 3.5,
    length: 34,
    position: elbowAxlePoint,
    rotation: [deg(90), 0, 0],
    reason: `Axle through the coaxial Arm 01 upper cup and length-flipped Arm 02 lower cup; cup faces meet at Z=${elbowContactPlaneZ}.`
  },
  {
    id: "inferred_wrist_axle",
    label: "Inferred wrist axle",
    color: "#303642",
    type: "cylinder",
    radius: 4,
    length: 38,
    position: wristJoint,
    rotation: [deg(90), 0, 0],
    reason: "Axle through Arm 02 wrist mount and Arm 03 lower pivot."
  },
  {
    id: "inferred_gripper_mount_axle",
    label: "Inferred gripper mount axle",
    color: "#303642",
    type: "cylinder",
    radius: 3.5,
    length: 36,
    position: gripperMountJoint,
    rotation: [deg(90), 0, 0],
    reason: "Fastener joining Arm 03 to the gripper base."
  },
  {
    id: "inferred_left_gear_axle",
    label: "Inferred left gear axle",
    color: "#303642",
    type: "cylinder",
    radius: 3,
    length: 36,
    position: gearLeftJoint,
    rotation: [deg(90), 0, 0],
    reason: "Fastener through left gear and gripper base."
  },
  {
    id: "inferred_right_gear_axle",
    label: "Inferred right gear axle",
    color: "#303642",
    type: "cylinder",
    radius: 3,
    length: 36,
    position: gearRightJoint,
    rotation: [deg(90), 0, 0],
    reason: "Fastener through right gear and gripper base."
  }
];
