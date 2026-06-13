import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";
import { getFunctions } from "firebase/functions";

export const firebaseConfig = {
  apiKey: "AIzaSyDT880xc8UTC1Nm4RK92nyezYX49EatRIA",
  authDomain: "sky-suite-d14ff.firebaseapp.com",
  projectId: "sky-suite-d14ff",
  storageBucket: "sky-suite-d14ff.firebasestorage.app",
  messagingSenderId: "346344658872",
  appId: "1:346344658872:web:3458b10fc3fcf593fee14d",
  measurementId: "G-42KNZC0V6S"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
export const functions = getFunctions(app);
