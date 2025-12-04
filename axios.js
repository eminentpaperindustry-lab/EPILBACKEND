import axios from "axios";

export default axios.create({
  baseURL: "https://epilbackend.onrender.com/api", // only ONE /api
});
