import axios from "axios";

export default axios.create({
  baseURL: "https://http://localhost:5000/api", // only ONE /api
});